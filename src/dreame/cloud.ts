import * as crypto from 'crypto';
import { Logger } from '../util/logger';

const API_HOST_SUFFIX = '.iot.dreame.tech';
const API_PORT = '13267';
const PASSWORD_SALT = 'RAylYC%fmSKp7%Tq';
const USER_AGENT = 'Dreame_Smarthome/2.1.9 (iPhone; iOS 18.4.1; Scale/3.00)';
const AUTHORIZATION = 'Basic ZHJlYW1lX2FwcHYxOkFQXmR2QHpAU1FZVnhOODg=';
const DEFAULT_TENANT_ID = '000000';
const DREAME_RLC = '1c80b3787b2266776bcdc481f37d8fa42ba10a30af81a6df-1';

const PATH_LOGIN = '/dreame-auth/oauth/token';
const PATH_DEVICE_LIST = '/dreame-user-iot/iotuserbind/device/listV2';
const PATH_DEVICE_INFO = '/dreame-user-iot/iotuserbind/device/info';

export interface DreameDevice {
  did: string;
  model: string;
  mac: string;
  name: string;
  localip?: string;
  masterUid?: string;
  bindDomain?: string;
}

export interface DreameProperty {
  did: string;
  siid: number;
  piid: number;
  value?: unknown;
}

export class DreameCloud {
  private country: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpireTime = 0;
  private tenantId: string = DEFAULT_TENANT_ID;
  private host: string | null = null;
  private failCount = 0;
  private _connected = false;
  private _username: string | null = null;
  private _password: string | null = null;
  private _uid: string | null = null;
  private _onTokenRefresh: ((newToken: string) => void) | null = null;

  constructor(private readonly log: Logger) {
    this.country = 'eu';
  }

  get connected(): boolean { return this._connected; }
  get uid(): string | null { return this._uid; }
  get token(): string | null { return this.accessToken; }
  get countryCode(): string { return this.country; }

  onTokenRefresh(callback: (newToken: string) => void): void {
    this._onTokenRefresh = callback;
  }

  setCountry(country: string): void {
    this.country = country.trim().toLowerCase();
  }

  private getApiUrl(): string {
    return `https://${this.country}${API_HOST_SUFFIX}:${API_PORT}`;
  }

  async login(username: string, password: string): Promise<void> {
    this._username = username;
    this._password = password;
    this.log.debug('Logging in to Dreame Cloud...');

    const hashedPassword = crypto
      .createHash('md5')
      .update(password + PASSWORD_SALT)
      .digest('hex');

    const body = `platform=IOS&scope=all&grant_type=password&username=${encodeURIComponent(username)}&password=${hashedPassword}&type=account`;
    const headers = this.buildAuthHeaders();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const res = await fetch(this.getApiUrl() + PATH_LOGIN, {
      method: 'POST',
      headers,
      body,
    });

    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`Dreame Cloud login failed (HTTP ${res.status}): ${text}`);
    }

    const data = await res.json() as Record<string, unknown>;
    if (!data['access_token']) {
      throw new Error(`Dreame Cloud login failed: no access_token. ${JSON.stringify(data)}`);
    }

    this.accessToken = data['access_token'] as string;
    this.refreshToken = (data['refresh_token'] as string) ?? null;
    this.tokenExpireTime = Date.now() + ((data['expires_in'] as number) * 1000) - 120_000;
    this.tenantId = (data['tenant_id'] as string) ?? this.tenantId;
    this._uid = (data['uid'] as string) ?? this._uid;
    this._connected = true;
    this.failCount = 0;

    this.log.info('Dreame Cloud login successful');
  }

  private async refreshLogin(): Promise<void> {
    if (!this.refreshToken) throw new Error('No refresh token available');

    this.log.debug('Refreshing access token...');
    const body = `platform=IOS&scope=all&grant_type=refresh_token&refresh_token=${encodeURIComponent(this.refreshToken)}`;
    const headers = this.buildAuthHeaders();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const res = await fetch(this.getApiUrl() + PATH_LOGIN, { method: 'POST', headers, body });
    if (res.status !== 200) {
      this.refreshToken = null;
      throw new Error('Refresh token expired');
    }

    const data = await res.json() as Record<string, unknown>;
    if (!data['access_token']) {
      this.refreshToken = null;
      throw new Error('Token refresh failed');
    }

    this.accessToken = data['access_token'] as string;
    this.refreshToken = (data['refresh_token'] as string) ?? null;
    this.tokenExpireTime = Date.now() + ((data['expires_in'] as number) * 1000) - 120_000;
    this.tenantId = (data['tenant_id'] as string) ?? this.tenantId;
    this._connected = true;
  }

  private async ensureToken(): Promise<void> {
    if (this.tokenExpireTime > 0 && Date.now() > this.tokenExpireTime) {
      try {
        await this.refreshLogin();
      } catch {
        if (this._username && this._password) {
          this.log.warn('Refresh token expired, re-logging in...');
          await this.login(this._username, this._password);
        } else {
          throw new Error('Token expired and no stored credentials');
        }
      }
      this._onTokenRefresh?.(this.accessToken!);
    }
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Accept-Language': 'en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': USER_AGENT,
      'Authorization': AUTHORIZATION,
      'Tenant-Id': this.tenantId,
    };
    if (this.country === 'cn') {
      headers['Dreame-Rlc'] = DREAME_RLC;
    }
    return headers;
  }

  private async request(path: string, data?: unknown, retryCount = 2): Promise<Record<string, unknown>> {
    if (!this.accessToken) throw new Error('Not logged in');
    await this.ensureToken();

    const url = this.getApiUrl() + path;
    let lastError: Error | null = null;

    for (let i = 0; i <= retryCount; i++) {
      try {
        const headers = this.buildAuthHeaders();
        headers['Content-Type'] = 'application/json';
        headers['Dreame-Auth'] = this.accessToken!;

        const fetchOptions: RequestInit = { method: 'POST', headers };
        if (data !== undefined) fetchOptions.body = JSON.stringify(data);

        const res = await fetch(url, fetchOptions);

        if (res.status === 401 && this.refreshToken) {
          this.log.warn('Token expired, refreshing...');
          await this.refreshLogin();
          continue;
        }

        if (res.status !== 200) {
          const text = await res.text();
          lastError = new Error(`API call failed (HTTP ${res.status}): ${text}`);
          continue;
        }

        const response = await res.json() as Record<string, unknown>;
        this.failCount = 0;
        this._connected = true;
        return response;
      } catch (err) {
        lastError = err as Error;
        this.log.warn(`Request failed (attempt ${i + 1}/${retryCount + 1}): ${lastError.message}`);
      }
    }

    this.failCount++;
    if (this.failCount >= 5) this._connected = false;
    throw lastError ?? new Error('API request failed');
  }

  async getDevices(): Promise<DreameDevice[]> {
    const response = await this.request(PATH_DEVICE_LIST);
    const data = response['data'] as Record<string, unknown> | undefined;
    if (!data || response['code'] !== 0) return [];

    const page = data['page'] as Record<string, unknown> | undefined;
    const records = (page?.['records'] as Array<Record<string, unknown>>) ?? [];

    return records.map((device) => ({
      did: device['did'] as string,
      model: device['model'] as string,
      mac: device['mac'] as string,
      name: (device['customName'] as string) ?? (device['model'] as string),
      localip: device['localip'] as string | undefined,
      masterUid: device['masterUid'] as string | undefined,
      bindDomain: device['bindDomain'] as string | undefined,
    }));
  }

  async getDeviceInfo(deviceId: string): Promise<Record<string, unknown> | null> {
    const response = await this.request(PATH_DEVICE_INFO, { did: deviceId });
    const data = response['data'] as Record<string, unknown> | undefined;
    if (!data || response['code'] !== 0) return null;

    this.host = (data['bindDomain'] as string) ?? null;
    return data;
  }

  async sendCommand(deviceId: string, method: string, params: unknown): Promise<unknown> {
    const hostPrefix = this.host ? `-${this.host.split('.')[0]!}` : '';
    const path = `/dreame-iot-com${hostPrefix}/device/sendCommand`;
    const id = Math.floor(Math.random() * 100_000);

    const response = await this.request(path, {
      did: deviceId,
      id,
      data: { did: deviceId, id, method, params },
    });

    const resData = response['data'] as Record<string, unknown> | undefined;
    return resData?.['result'] ?? null;
  }

  async getProperties(deviceId: string, params: DreameProperty[]): Promise<DreameProperty[]> {
    const result = await this.sendCommand(deviceId, 'get_properties', params);
    return (result as DreameProperty[]) ?? [];
  }

  async setProperties(deviceId: string, params: DreameProperty[]): Promise<unknown> {
    return this.sendCommand(deviceId, 'set_properties', params);
  }

  async action(deviceId: string, siid: number, aiid: number, params: unknown[] = []): Promise<unknown> {
    return this.sendCommand(deviceId, 'action', {
      did: deviceId,
      siid,
      aiid,
      in: params,
    });
  }
}
