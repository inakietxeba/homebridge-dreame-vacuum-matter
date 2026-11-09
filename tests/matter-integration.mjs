import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { MatterServer } from '../node_modules/homebridge/dist/matter/server.js';
import { deviceTypes } from '../node_modules/homebridge/dist/matter/types.js';
import { createInitialState } from '../dist/dreame/models.js';
import { StateParser } from '../dist/dreame/parser.js';
import { buildMatterAccessory } from '../dist/registration.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const pluginName = 'homebridge-dreame-vacuum-matter';
const platformName = 'DreameVacuumMatter';

test('Homebridge Matter registers and controls synthetic Dreame vacuums', async (t) => {
  const storagePath = await realpath(await mkdtemp(join(process.cwd(), '.matter-integration-')));
  t.after(() => rm(storagePath, { recursive: true, force: true, maxRetries: 5 }));
  let nextBridgeId = 0;

  async function withRobot(model, arrange, verify, options = {}) {
    const id = options.id ?? nextBridgeId++;
    const identity = { deviceId: `robot-${id}`, model: `dreame.vacuum.${model}`, firmware: '1.0' };
    const state = createInitialState(identity);
    arrange(state);
    const server = new MatterServer({
      port: 5590,
      uniqueId: `D2EA000000${id.toString(16).padStart(2, '0')}`,
      storagePath,
      displayName: 'Synthetic Dreame',
      externalAccessory: true,
    });
    const uuid = `synthetic-${id}`;
    const calls = [];
    const handlers = Object.fromEntries([
      'handleStartCommand', 'handleStopCommand', 'handlePauseCommand', 'handleResumeCommand',
      'handleGoHomeCommand', 'handleCleaningProfile', 'handleAreaSelection',
    ].map((method) => [method, async (...args) => {
      if (method === options.rejectCommand) throw new Error('Synthetic Dreame rejected command');
      calls.push([method, ...args]);
    }]));
    const accessory = buildMatterAccessory({
      deviceTypes,
      uuid: { generate: () => uuid },
      updateAccessoryState: server.updateAccessoryState.bind(server),
    }, handlers, identity, state, 'Synthetic Dreame', logger);
    if (options.legacyRunMode) {
      const runMode = accessory.clusters.rvcRunMode;
      runMode.supportedModes = [
        ...runMode.supportedModes, { label: 'Legacy return', mode: 2, modeTags: [{ value: 0x4001 }] },
      ];
      runMode.currentMode = 2;
    }
    const read = (cluster) => server.getAccessoryState(uuid, cluster);
    const command = (cluster, name, args) => server.triggerCommand(uuid, cluster, name, args);
    try {
      await server.start();
      await server.registerPlatformAccessories(pluginName, platformName, [accessory]);
      assert.equal(server.getServerInfo().deviceCount, 1);
      await verify({ read, command, calls });
    } finally {
      await server.stop();
    }
  }

  for (const [model, mode, paused, docked, charging, error, runMode, operationalState] of [
    ['r2253c', 'idle', false, true, false, null, 0, 0x42],
    ['r9419a', 'returning', false, false, false, null, 0, 0x40],
    ['r2253c', 'cleaning', false, false, false, null, 1, 1],
    ['r9419a', 'cleaning', true, false, false, null, 1, 2],
    ['r9419a', 'idle', false, true, true, null, 0, 0x41],
    ['r2253c', 'mapping', false, false, false, null, 3, 1],
    ['r2253c', 'error', false, false, false, 'Synthetic error', 0, 3],
  ]) {
    await t.test(`startup: ${model} ${mode} (${operationalState})`, () => withRobot(model, (state) => {
      Object.assign(state.activity, { runMode: mode, paused, activeError: error });
      Object.assign(state.power, { docked, charging });
    }, ({ read }) => {
      assert.equal(read('rvcRunMode').currentMode, runMode);
      assert.equal(read('rvcOperationalState').operationalState, operationalState);
    }));
  }

  await t.test('startup accepts duplicate and overlong map and room names', () => withRobot('r9419a', (state) => {
    const name = 'F'.repeat(65);
    state.activity.knownMaps = [
      { mapId: 1, name, rooms: [{ id: '1', name: 'R'.repeat(129) }, { id: '2', name: 'R'.repeat(129) }] },
      { mapId: 2, name, rooms: [{ id: '1', name: 'Kitchen' }] },
    ];
  }, ({ read }) => {
    const area = read('serviceArea');
    assert.equal(area.supportedAreas.length, 3);
    assert.equal(new Set(area.supportedAreas.map(({ areaId }) => areaId)).size, 3);
    assert.equal(new Set(area.supportedMaps.map(({ name }) => name)).size, 2);
  }));

  await t.test('startup preserves valid battery data and accepts room-only setups', () => withRobot('r2253c', (state) => {
    state.activity.availableRooms = [{ id: '1', name: 'Kitchen' }, { id: '2', name: 'Kitchen' }];
    state.power.batteryPercent = 85;
    Object.assign(state, new StateParser(logger).processProperties([{ siid: 3, piid: 1, value: 'unknown' }], state));
  }, ({ read }) => {
    assert.equal(read('powerSource').batPercentRemaining, 170);
    assert.equal(read('serviceArea').supportedAreas.length, 2);
  }));

  await t.test('Matter dispatches area, cleaning, pause, resume, stop and dock commands', () => withRobot('r2253c', (state) => {
    state.activity.knownMaps = [{ mapId: 1, name: 'Floor', rooms: [{ id: '1', name: 'Kitchen' }] }];
  }, async ({ read, command, calls }) => {
    await command('serviceArea', 'selectAreas', { newAreas: [1] });
    await command('rvcCleanMode', 'changeToMode', { newMode: 4 });
    assert.equal(read('rvcCleanMode').currentMode, 4);
    await command('rvcRunMode', 'changeToMode', { newMode: 1 });
    assert.equal(read('rvcOperationalState').operationalState, 1);
    await command('rvcOperationalState', 'pause');
    assert.equal(read('rvcOperationalState').operationalState, 2);
    await command('rvcOperationalState', 'resume');
    assert.equal(read('rvcOperationalState').operationalState, 1);
    await command('rvcRunMode', 'changeToMode', { newMode: 0 });
    assert.equal(read('rvcOperationalState').operationalState, 0);
    await command('rvcOperationalState', 'goHome');
    assert.equal(read('rvcRunMode').currentMode, 0);
    assert.equal(read('rvcOperationalState').operationalState, 0x40);
    await assert.rejects(command('rvcRunMode', 'changeToMode', { newMode: 3 }), /Unsupported Dreame run mode/);
    assert.equal(read('rvcRunMode').currentMode, 0);
    assert.deepEqual(calls, [
      ['handleAreaSelection', [1]], ['handleCleaningProfile', 'QUIET', 'SWEEP'], ['handleStartCommand', false],
      ['handlePauseCommand'], ['handleResumeCommand'], ['handleStopCommand'], ['handleGoHomeCommand'],
    ]);
  }));

  await t.test('Dreame command rejection does not update the Matter state', () => withRobot('r9419a', () => {}, async ({ command, read }) => {
    await assert.rejects(command('rvcOperationalState', 'goHome'), /Synthetic Dreame rejected command/);
    assert.equal(read('rvcOperationalState').operationalState, 0x42);
  }, { rejectCommand: 'handleGoHomeCommand' }));

  await t.test('registered accessory can restart after previously advertising run mode 2', async () => {
    const id = nextBridgeId++;
    await withRobot('r9419a', () => {}, ({ read }) => {
      assert.equal(read('rvcRunMode').currentMode, 2);
    }, { id, legacyRunMode: true });
    await withRobot('r9419a', (state) => {
      state.activity.runMode = 'returning';
    }, ({ read }) => {
      assert.equal(read('rvcRunMode').currentMode, 0);
      assert.equal(read('rvcOperationalState').operationalState, 0x40);
    }, { id });
  });
});
