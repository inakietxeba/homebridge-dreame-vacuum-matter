/**
 * Scans ALL known Dreame MIoT properties from the robot to understand
 * what data is available for Matter mapping.
 *
 * Usage: export $(cat ../homebridge-dreame-vacuum/.env | grep -v '^#' | xargs) && npx tsx scripts/scan-properties.ts
 */

/* eslint-disable no-console */

import { DreameCloud } from '../src/dreame/cloud';
import { Logger } from '../src/util/logger';

const DREAME_EMAIL = process.env['DREAME_EMAIL']!;
const DREAME_PASSWORD = process.env['DREAME_PASSWORD']!;
const DREAME_COUNTRY = process.env['DREAME_COUNTRY'] || 'eu';

if (!DREAME_EMAIL || !DREAME_PASSWORD) {
  console.error('Missing DREAME_EMAIL or DREAME_PASSWORD');
  process.exit(1);
}

const rawLog = {
  info: (...args: unknown[]) => {},
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  debug: (...args: unknown[]) => {},
} as any;

const log = new Logger(rawLog, 'Scan');

// All known Dreame MIoT service/property pairs from the HA Tasshack integration
// and MIoT spec files. We scan a wide range to discover what the robot supports.
const PROPERTY_SCAN: Array<{ siid: number; piid: number; label: string }> = [
  // siid 2 — Device Information / State
  { siid: 2, piid: 1, label: 'Device State' },
  { siid: 2, piid: 2, label: 'Device Error' },
  { siid: 2, piid: 3, label: 'Device SubState' },

  // siid 3 — Battery
  { siid: 3, piid: 1, label: 'Battery Level' },
  { siid: 3, piid: 2, label: 'Charge Status' },

  // siid 4 — Vacuum Settings / Cleaning
  { siid: 4, piid: 1, label: 'Cleaning Status / Task Status' },
  { siid: 4, piid: 2, label: 'Cleaning Mode Alt' },
  { siid: 4, piid: 3, label: 'Cleaning Time (minutes)' },
  { siid: 4, piid: 4, label: 'Suction Level' },
  { siid: 4, piid: 5, label: 'Water Level / Mop Intensity' },
  { siid: 4, piid: 6, label: 'Cleaning Area (m²)' },
  { siid: 4, piid: 7, label: 'Work Mode' },
  { siid: 4, piid: 8, label: 'Cleaning Total Time' },
  { siid: 4, piid: 9, label: 'Cleaning Total Area' },
  { siid: 4, piid: 10, label: 'Cleaning Total Count' },
  { siid: 4, piid: 11, label: 'Carpet Boost' },
  { siid: 4, piid: 12, label: 'Auto Empty Dustbin' },
  { siid: 4, piid: 13, label: 'Customized Clean' },
  { siid: 4, piid: 14, label: 'Child Lock' },
  { siid: 4, piid: 15, label: 'Carpet Sensitivity' },
  { siid: 4, piid: 16, label: 'Tight Mopping' },
  { siid: 4, piid: 17, label: 'Carpet Avoidance' },
  { siid: 4, piid: 18, label: 'Auto Add Detergent' },
  { siid: 4, piid: 19, label: 'DND Enabled' },
  { siid: 4, piid: 20, label: 'DND Start Time' },
  { siid: 4, piid: 21, label: 'DND End Time' },
  { siid: 4, piid: 22, label: 'Multi Floor Map' },
  { siid: 4, piid: 23, label: 'Cleaning Mode' },
  { siid: 4, piid: 24, label: 'Volume' },
  { siid: 4, piid: 25, label: 'Voice Packet ID' },
  { siid: 4, piid: 26, label: 'Timezone' },
  { siid: 4, piid: 27, label: 'Main Brush Life Remaining' },
  { siid: 4, piid: 28, label: 'Side Brush Life Remaining' },
  { siid: 4, piid: 29, label: 'Filter Life Remaining' },
  { siid: 4, piid: 30, label: 'Mop Life Remaining' },
  { siid: 4, piid: 31, label: 'Sensor Life Remaining' },
  { siid: 4, piid: 32, label: 'Auto Dust Collection' },
  { siid: 4, piid: 33, label: 'Auto Empty Mode' },
  { siid: 4, piid: 34, label: 'Mop Wash Interval' },
  { siid: 4, piid: 35, label: 'Mop Wash Level' },
  { siid: 4, piid: 36, label: 'Hot Water Washing' },

  // siid 5 — Map
  { siid: 5, piid: 1, label: 'Map / Frame Info' },
  { siid: 5, piid: 2, label: 'Map Object Name' },
  { siid: 5, piid: 3, label: 'Robot Position' },
  { siid: 5, piid: 4, label: 'Map Data' },

  // siid 6 — Audio
  { siid: 6, piid: 1, label: 'Audio Volume' },
  { siid: 6, piid: 2, label: 'Audio Voice ID' },

  // siid 7 — Timer / Schedule
  { siid: 7, piid: 1, label: 'Schedule Enabled' },
  { siid: 7, piid: 2, label: 'Schedule Data' },

  // siid 8 — Clean Record
  { siid: 8, piid: 1, label: 'Clean Record Last' },
  { siid: 8, piid: 2, label: 'Clean Record Total Time' },
  { siid: 8, piid: 3, label: 'Clean Record Total Area' },
  { siid: 8, piid: 4, label: 'Clean Record Total Count' },

  // siid 9 — Remote Control
  { siid: 9, piid: 1, label: 'Remote Control' },

  // siid 10 — Station / Dock
  { siid: 10, piid: 1, label: 'Station Status' },
  { siid: 10, piid: 2, label: 'Station Error' },
  { siid: 10, piid: 3, label: 'Station Self Clean' },
  { siid: 10, piid: 4, label: 'Station Auto Dust' },
  { siid: 10, piid: 5, label: 'Station Drying' },
  { siid: 10, piid: 6, label: 'Station Drying Duration' },
  { siid: 10, piid: 7, label: 'Station Drying Remaining' },
  { siid: 10, piid: 8, label: 'Station Water Level' },
  { siid: 10, piid: 9, label: 'Station Detergent Level' },

  // siid 11 — Consumables  
  { siid: 11, piid: 1, label: 'Main Brush Hours' },
  { siid: 11, piid: 2, label: 'Side Brush Hours' },
  { siid: 11, piid: 3, label: 'Filter Hours' },
  { siid: 11, piid: 4, label: 'Sensor Hours' },
  { siid: 11, piid: 5, label: 'Mop Hours' },
  { siid: 11, piid: 6, label: 'Silver Ion Hours' },
  { siid: 11, piid: 7, label: 'Detergent Hours' },
  { siid: 11, piid: 8, label: 'Squeegee Hours' },
  { siid: 11, piid: 9, label: 'Onboard Dirty Water Tank' },
  { siid: 11, piid: 10, label: 'Dirty Water Tank' },

  // siid 12 — AI / Obstacle  
  { siid: 12, piid: 1, label: 'AI Obstacle Detection' },
  { siid: 12, piid: 2, label: 'AI Pet Detection' },
  { siid: 12, piid: 3, label: 'AI Furniture Detection' },
  { siid: 12, piid: 4, label: 'AI Image Upload' },

  // siid 13 — Network
  { siid: 13, piid: 1, label: 'WiFi RSSI' },
  { siid: 13, piid: 2, label: 'WiFi SSID' },
  { siid: 13, piid: 3, label: 'WiFi IP' },
  { siid: 13, piid: 4, label: 'WiFi MAC' },

  // siid 14 — OTA
  { siid: 14, piid: 1, label: 'OTA State' },
  { siid: 14, piid: 2, label: 'OTA Progress' },
];

async function main() {
  console.log('=== Dreame Robot Full Property Scan ===\n');

  const cloud = new DreameCloud(log);
  cloud.setCountry(DREAME_COUNTRY);
  await cloud.login(DREAME_EMAIL, DREAME_PASSWORD);

  const devices = await cloud.getDevices();
  if (devices.length === 0) { console.log('No devices'); process.exit(0); }

  const device = devices[0]!;
  console.log(`Device: ${device.name} (${device.model})\n`);
  await cloud.getDeviceInfo(device.did);

  // Scan in batches of 15 (API limit)
  const BATCH_SIZE = 15;
  const results: Array<{ siid: number; piid: number; label: string; value: unknown; error?: string }> = [];

  for (let i = 0; i < PROPERTY_SCAN.length; i += BATCH_SIZE) {
    const batch = PROPERTY_SCAN.slice(i, i + BATCH_SIZE);
    const params = batch.map((p) => ({ did: device.did, siid: p.siid, piid: p.piid }));

    try {
      const props = await cloud.getProperties(device.did, params);
      for (const item of batch) {
        const found = props?.find((r: any) => r.siid === item.siid && r.piid === item.piid);
        if (found && found.code === 0 && found.value !== undefined) {
          results.push({ ...item, value: found.value });
        } else if (found && found.code !== undefined && found.code !== 0) {
          results.push({ ...item, value: null, error: `code=${found.code}` });
        } else {
          results.push({ ...item, value: null, error: 'no response' });
        }
      }
    } catch (err: unknown) {
      for (const item of batch) {
        results.push({ ...item, value: null, error: (err as Error).message });
      }
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // Display results grouped by service
  let currentSiid = -1;
  const siidNames: Record<number, string> = {
    2: 'Device State',
    3: 'Battery',
    4: 'Vacuum / Cleaning',
    5: 'Map',
    6: 'Audio',
    7: 'Schedule',
    8: 'Clean Records',
    9: 'Remote Control',
    10: 'Station / Dock',
    11: 'Consumables',
    12: 'AI / Obstacle',
    13: 'Network',
    14: 'OTA',
  };

  const available: typeof results = [];
  const unavailable: typeof results = [];

  for (const r of results) {
    if (r.value !== null && r.value !== undefined) {
      available.push(r);
    } else {
      unavailable.push(r);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`AVAILABLE PROPERTIES (${available.length}/${results.length})`);
  console.log(`${'='.repeat(70)}\n`);

  currentSiid = -1;
  for (const r of available) {
    if (r.siid !== currentSiid) {
      currentSiid = r.siid;
      console.log(`\n--- siid ${r.siid}: ${siidNames[r.siid] ?? 'Unknown'} ---`);
    }
    const valueStr = typeof r.value === 'string' && r.value.length > 80
      ? r.value.substring(0, 80) + '...'
      : JSON.stringify(r.value);
    console.log(`  [${r.siid}.${r.piid}] ${r.label.padEnd(32)} = ${valueStr}`);
  }

  console.log(`\n\n${'='.repeat(70)}`);
  console.log('MATTER MAPPING ANALYSIS');
  console.log(`${'='.repeat(70)}\n`);

  // Analyze what we currently map vs what we could map
  const currentlyMapped = [
    '2.1 → RvcRunMode.currentMode + RvcOperationalState.operationalState',
    '2.2 → RvcOperationalState.operationalError',
    '3.1 → PowerSource.batPercentRemaining + batChargeLevel',
    '3.2 → PowerSource.batChargeState',
    '4.4 → (suction level — no direct Matter cluster)',
    '4.5 → (water level — no direct Matter cluster)',
    '4.23 → RvcCleanMode.currentMode',
  ];

  console.log('Currently mapped:');
  for (const m of currentlyMapped) {
    console.log(`  ✓ ${m}`);
  }

  console.log('\nPotential additional mappings from available data:\n');

  // Check what's available that could map to Matter
  const potentialMappings: Array<{ prop: string; matterTarget: string; available: boolean; reason: string }> = [];

  const has = (s: number, p: number) => available.some((r) => r.siid === s && r.piid === p);
  const val = (s: number, p: number) => available.find((r) => r.siid === s && r.piid === p)?.value;

  // WiFi RSSI → could map to diagnostics but Matter RVC doesn't have WiFi cluster
  if (has(13, 1)) {
    potentialMappings.push({
      prop: `13.1 WiFi RSSI = ${val(13, 1)}`,
      matterTarget: 'WiFiNetworkDiagnostics.rssi',
      available: true,
      reason: 'Matter has WiFiNetworkDiagnostics but not part of RVC device type',
    });
  }

  // Consumable life → no direct Matter equivalent for RVC
  for (const piid of [27, 28, 29, 30, 31]) {
    if (has(4, piid)) {
      const labels: Record<number, string> = {
        27: 'Main Brush Life', 28: 'Side Brush Life', 29: 'Filter Life',
        30: 'Mop Life', 31: 'Sensor Life',
      };
      potentialMappings.push({
        prop: `4.${piid} ${labels[piid]} = ${val(4, piid)}%`,
        matterTarget: 'N/A — Matter RVC has no consumable life cluster',
        available: true,
        reason: 'No Matter equivalent. Could be custom attribute in future spec.',
      });
    }
  }

  // Station/dock info
  if (has(10, 1)) {
    potentialMappings.push({
      prop: `10.1 Station Status = ${val(10, 1)}`,
      matterTarget: 'N/A — Station is not part of Matter RVC spec',
      available: true,
      reason: 'Dock info. Matter RVC only models the robot itself.',
    });
  }
  if (has(10, 8)) {
    potentialMappings.push({
      prop: `10.8 Station Water Level = ${val(10, 8)}`,
      matterTarget: 'RvcOperationalState (indirectly)',
      available: true,
      reason: 'Could trigger FILLING_WATER_TANK (0x45) state if empty',
    });
  }

  // AI detection
  if (has(12, 1)) {
    potentialMappings.push({
      prop: `12.1 AI Obstacle Detection = ${val(12, 1)}`,
      matterTarget: 'N/A',
      available: true,
      reason: 'No Matter RVC equivalent.',
    });
  }

  // Cleaning area / time → could enrich ServiceArea or be diagnostic
  if (has(4, 3)) {
    potentialMappings.push({
      prop: `4.3 Cleaning Time = ${val(4, 3)} min`,
      matterTarget: 'RvcOperationalState (no direct attr)',
      available: true,
      reason: 'Matter 1.4 RvcOperationalState has no cleaning-time attribute.',
    });
  }
  if (has(4, 6)) {
    potentialMappings.push({
      prop: `4.6 Cleaning Area = ${val(4, 6)} m²`,
      matterTarget: 'RvcOperationalState (no direct attr)',
      available: true,
      reason: 'Matter 1.4 RvcOperationalState has no cleaned-area attribute.',
    });
  }

  // DND / Schedule
  if (has(4, 19)) {
    potentialMappings.push({
      prop: `4.19 DND Enabled = ${val(4, 19)}`,
      matterTarget: 'N/A',
      available: true,
      reason: 'No Matter equivalent for Do Not Disturb.',
    });
  }

  // Child lock
  if (has(4, 14)) {
    potentialMappings.push({
      prop: `4.14 Child Lock = ${val(4, 14)}`,
      matterTarget: 'N/A',
      available: true,
      reason: 'No Matter RVC equivalent.',
    });
  }

  // Carpet boost
  if (has(4, 11)) {
    potentialMappings.push({
      prop: `4.11 Carpet Boost = ${val(4, 11)}`,
      matterTarget: 'N/A — could be custom RvcCleanMode tag',
      available: true,
      reason: 'Not a standard Matter attribute but influences cleaning behavior.',
    });
  }

  // Auto empty dustbin
  if (has(4, 12) || has(4, 32)) {
    const v = val(4, 12) ?? val(4, 32);
    potentialMappings.push({
      prop: `4.${has(4, 12) ? 12 : 32} Auto Empty Dustbin = ${v}`,
      matterTarget: 'Relates to EMPTYING_DUST_BIN (0x43) state',
      available: true,
      reason: 'Tells us if auto-empty is enabled — when active, maps to maintenance state.',
    });
  }

  // Volume
  if (has(4, 24) || has(6, 1)) {
    const v = val(4, 24) ?? val(6, 1);
    potentialMappings.push({
      prop: `Audio Volume = ${v}`,
      matterTarget: 'N/A',
      available: true,
      reason: 'No Matter RVC equivalent for volume control.',
    });
  }

  // Firmware / OTA
  if (has(14, 1)) {
    potentialMappings.push({
      prop: `14.1 OTA State = ${val(14, 1)}`,
      matterTarget: 'OtaSoftwareUpdateRequestor (different device type)',
      available: true,
      reason: 'Matter has OTA clusters but separate from RVC device type.',
    });
  }

  for (const pm of potentialMappings) {
    const icon = pm.matterTarget.startsWith('N/A') ? '✗' : '?';
    console.log(`  ${icon} ${pm.prop}`);
    console.log(`    → ${pm.matterTarget}`);
    console.log(`    ${pm.reason}\n`);
  }

  console.log(`${'='.repeat(70)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log(`Properties available: ${available.length}`);
  console.log(`Properties unavailable: ${unavailable.length}`);
  console.log(`Currently mapped to Matter: 7 properties`);
  console.log(`Additional mappable to Matter: check analysis above`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Scan failed:', err);
  process.exit(1);
});
