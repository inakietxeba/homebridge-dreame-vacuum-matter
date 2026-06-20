import { describe, expect, it, vi } from 'vitest';
import { AutomationDockSwitch, AUTOMATION_DOCK_SWITCH_CONTEXT_KIND } from '../src/homekit/automation-dock-switch';

function createFixture(returnToDock = vi.fn().mockResolvedValue(undefined)) {
  let onGet: (() => boolean) | undefined;
  let onSet: ((value: boolean) => Promise<void>) | undefined;
  const characteristic = {
    onGet: vi.fn((handler) => {
      onGet = handler;
      return characteristic;
    }),
    onSet: vi.fn((handler) => {
      onSet = handler;
      return characteristic;
    }),
  };
  const switchService = {
    setCharacteristic: vi.fn().mockReturnThis(),
    updateCharacteristic: vi.fn().mockReturnThis(),
    getCharacteristic: vi.fn(() => characteristic),
  };
  const infoService = { setCharacteristic: vi.fn().mockReturnThis() };
  const accessory = {
    context: {},
    getService: vi.fn((type) => type === 'AccessoryInformation' ? infoService : undefined),
    addService: vi.fn(() => switchService),
  };
  const api = {
    hap: {
      Service: { AccessoryInformation: 'AccessoryInformation', Switch: 'Switch' },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
        On: 'On',
      },
    },
  };

  new AutomationDockSwitch(
    api as any,
    accessory as any,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    'Robot',
    'dev-1',
    'dreame.vacuum.test',
    returnToDock,
  );

  return { accessory, switchService, returnToDock, getOnGet: () => onGet!, getOnSet: () => onSet! };
}

describe('AutomationDockSwitch', () => {
  it('should expose a stateless return-to-dock switch', async () => {
    const fixture = createFixture();

    expect(fixture.accessory.context).toEqual({
      kind: AUTOMATION_DOCK_SWITCH_CONTEXT_KIND,
      deviceId: 'dev-1',
      model: 'dreame.vacuum.test',
    });
    expect(fixture.getOnGet()()).toBe(false);

    await fixture.getOnSet()(true);

    expect(fixture.returnToDock).toHaveBeenCalledOnce();
    expect(fixture.switchService.updateCharacteristic).toHaveBeenLastCalledWith('On', false);
  });

  it('should ignore off writes', async () => {
    const fixture = createFixture();

    await fixture.getOnSet()(false);

    expect(fixture.returnToDock).not.toHaveBeenCalled();
  });

  it('should reset after a failed dock command', async () => {
    const returnToDock = vi.fn().mockRejectedValue(new Error('cloud failed'));
    const fixture = createFixture(returnToDock);

    await expect(fixture.getOnSet()(true)).rejects.toThrow('cloud failed');
    expect(fixture.switchService.updateCharacteristic).toHaveBeenLastCalledWith('On', false);
  });
});
