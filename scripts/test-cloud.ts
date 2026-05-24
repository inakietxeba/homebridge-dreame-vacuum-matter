/**
 * Test script: connects to Dreame Cloud with real credentials,
 * fetches devices and current state, and tests MQTT subscription.
 *
 * Usage: source ../homebridge-dreame-vacuum/.env && npx ts-node scripts/test-cloud.ts
 */

/* eslint-disable no-console */

import { DreameCloud } from '../src/dreame/cloud';
import { DreameMqttClient, MqttConnectionInfo } from '../src/dreame/mqtt';
import { StateParser } from '../src/dreame/parser';
import { createInitialState } from '../src/dreame/models';
import { Logger } from '../src/util/logger';

const DREAME_EMAIL = process.env['DREAME_EMAIL'];
const DREAME_PASSWORD = process.env['DREAME_PASSWORD'];
const DREAME_COUNTRY = process.env['DREAME_COUNTRY'] || 'eu';

if (!DREAME_EMAIL || !DREAME_PASSWORD) {
  console.error('Missing DREAME_EMAIL or DREAME_PASSWORD env vars');
  console.error('Usage: source ../homebridge-dreame-vacuum/.env && npx tsx scripts/test-cloud.ts');
  process.exit(1);
}

const rawLog = {
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  debug: (...args: unknown[]) => console.log('[DEBUG]', ...args),
} as any;

const log = new Logger(rawLog, 'Test');

const STATE_MAP: Record<number, string> = {
  1: 'Sweeping', 2: 'Idle', 3: 'Paused', 4: 'Error', 5: 'Returning',
  6: 'Charging', 7: 'Mopping', 8: 'Drying', 9: 'Washing',
  10: 'Going to wash', 11: 'Building map', 12: 'Sweeping+Mopping',
  13: 'Charge complete',
};
const SUCTION_MAP: Record<number, string> = { 0: 'Quiet', 1: 'Standard', 2: 'Strong', 3: 'Turbo' };
const WATER_MAP: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };
const MODE_MAP: Record<number, string> = { 0: 'Sweep', 1: 'Mop', 2: 'Sweep+Mop' };
const CHARGE_MAP: Record<number, string> = { 1: 'Charging', 2: 'Not charging', 3: 'Charged' };

async function main() {
  console.log('\n=== Dreame Cloud + MQTT Test ===\n');

  // Phase 1: Cloud login
  const cloud = new DreameCloud(log);
  cloud.setCountry(DREAME_COUNTRY);
  await cloud.login(DREAME_EMAIL!, DREAME_PASSWORD!);
  console.log('✓ Cloud login successful (uid:', cloud.uid, ')');

  // Phase 2: Device discovery
  const devices = await cloud.getDevices();
  console.log(`✓ Found ${devices.length} device(s)\n`);

  if (devices.length === 0) {
    console.log('No devices found. Check your account.');
    process.exit(0);
  }

  for (const device of devices) {
    console.log(`--- ${device.name} ---`);
    console.log(`  DID:    ${device.did}`);
    console.log(`  Model:  ${device.model}`);
    console.log(`  MAC:    ${device.mac}`);
    console.log(`  MQTT:   ${device.bindDomain || 'N/A'}`);
  }

  // Phase 3: Get device info & properties
  const device = devices[0]!;
  await cloud.getDeviceInfo(device.did);

  const props = await cloud.getProperties(device.did, [
    { did: device.did, siid: 2, piid: 1 },
    { did: device.did, siid: 2, piid: 2 },
    { did: device.did, siid: 3, piid: 1 },
    { did: device.did, siid: 3, piid: 2 },
    { did: device.did, siid: 4, piid: 4 },
    { did: device.did, siid: 4, piid: 5 },
    { did: device.did, siid: 4, piid: 23 },
  ]);

  const val = (s: number, p: number): unknown => {
    const found = props?.find((r) => r.siid === s && r.piid === p);
    return found?.value ?? '?';
  };

  console.log(`\n=== ${device.name} — Current State (HTTP) ===`);
  const stateVal = val(2, 1) as number;
  const errorVal = val(2, 2) as number;
  const batteryVal = val(3, 1) as number;
  const chargeVal = val(3, 2) as number;
  const suctionVal = val(4, 4) as number;
  const waterVal = val(4, 5) as number;
  const modeVal = val(4, 23) as number;

  console.log(`  State:    ${STATE_MAP[stateVal] ?? stateVal}`);
  console.log(`  Error:    ${errorVal === 0 ? 'None' : errorVal}`);
  console.log(`  Battery:  ${batteryVal}%`);
  console.log(`  Charge:   ${CHARGE_MAP[chargeVal] ?? chargeVal}`);
  console.log(`  Suction:  ${SUCTION_MAP[suctionVal] ?? suctionVal}`);
  console.log(`  Water:    ${WATER_MAP[waterVal] ?? waterVal}`);
  console.log(`  Mode:     ${MODE_MAP[modeVal] ?? modeVal}`);

  // Phase 4: Parse into NormalizedState
  const parser = new StateParser(log);
  const identity = { deviceId: device.did, model: device.model, firmware: '1.0' };
  const initialState = createInitialState(identity);
  const propsArray = props
    .filter((p) => p.value !== undefined)
    .map((p) => ({ siid: p.siid, piid: p.piid, value: p.value }));
  const state = parser.processProperties(propsArray, initialState);

  console.log('\n=== NormalizedState ===');
  console.log(`  runMode:         ${state.activity.runMode}`);
  console.log(`  maintenanceType: ${state.activity.maintenanceType ?? 'N/A'}`);
  console.log(`  paused:          ${state.activity.paused}`);
  console.log(`  cleanMode:       ${state.activity.cleanMode}`);
  console.log(`  suction:         ${state.activity.suctionLevel}`);
  console.log(`  water:           ${state.activity.waterLevel}`);
  console.log(`  battery:         ${state.power.batteryPercent}%`);
  console.log(`  charging:        ${state.power.charging}`);
  console.log(`  docked:          ${state.power.docked}`);
  console.log(`  error:           ${state.activity.activeError ?? 'None'}`);

  // Phase 4b: Show Matter cluster output
  const { MatterClusterMapper } = await import('../src/matter/clusters');
  const { MatterMappers } = await import('../src/matter/mappers');
  const matterState = MatterClusterMapper.toMatterState(state);

  console.log('\n=== Matter Cluster Output ===');
  for (const [cluster, payload] of Object.entries(matterState)) {
    console.log(`\n  [${cluster}]`);
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const val = typeof value === 'object' ? JSON.stringify(value) : value;
      console.log(`    ${key}: ${val}`);
    }
  }
  // Phase 5: Test MQTT connection
  if (device.bindDomain && cloud.uid && cloud.token) {
    console.log('\n=== MQTT Test ===');
    const mqttHost = device.bindDomain.includes(':') ? device.bindDomain : `${device.bindDomain}:19328`;
    console.log(`Connecting to ${mqttHost}...`);

    const mqttInfo: MqttConnectionInfo = {
      host: mqttHost,
      did: device.did,
      uid: cloud.uid,
      model: device.model,
      accessToken: cloud.token,
      country: DREAME_COUNTRY,
    };

    const mqttClient = new DreameMqttClient(log, mqttInfo);
    let messageCount = 0;

    mqttClient.on('message', (properties) => {
      messageCount++;
      console.log(`\n[MQTT #${messageCount}] Received ${properties.length} property update(s):`);
      for (const prop of properties) {
        const label = `siid=${prop.siid} piid=${prop.piid}`;
        console.log(`  ${label} → ${JSON.stringify(prop.value)}`);
      }
    });

    mqttClient.on('connected', () => {
      console.log('✓ MQTT connected! Waiting for state updates (30s)...');
      console.log('  (Try changing a setting in the Dreamehome app to trigger an update)');
    });

    mqttClient.on('error', (err) => {
      console.error('✗ MQTT error:', err.message);
    });

    mqttClient.connect();

    // Wait 30 seconds for MQTT messages
    await new Promise((resolve) => setTimeout(resolve, 30_000));

    console.log(`\n=== MQTT Summary: ${messageCount} message(s) received in 30s ===`);
    mqttClient.disconnect();
  } else {
    console.log('\n⚠ No MQTT endpoint available — skipping MQTT test');
  }

  console.log('\n✓ Test complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
