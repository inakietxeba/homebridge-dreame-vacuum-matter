# homebridge-dreame-vacuum-matter

Matter-native Homebridge v2 plugin for Dreame vacuum robots.

Connects to **Dreame Cloud** for authentication and device commands, and subscribes to **MQTT** for real-time state updates — exactly like the Dreamehome app.

## Features

- **Matter-native**: Exposes your Dreame vacuum as a Matter RoboticVacuumCleaner device
- **Real-time state**: MQTT push from Dreame Cloud (battery, cleaning state, errors)
- **Cleaning modes**: Sweep, Mop, Sweep & Mop — selectable from Apple Home
- **Operational states**: Running, Paused, Docked, Charging, Seeking Charger, Error
- **Optional automation sensors**: Disabled by default; exposes separate HomeKit contact sensors for Idle, Busy, Cleaning, and Error states
- **Optional dock automation**: Exposes a momentary HomeKit switch for return-to-dock actions in classic automations
- **Identify support**: Locate/identify command is forwarded to compatible Dreame models
- **Auto token refresh**: Seamless credential management with Dreame Cloud

## Requirements

- **Homebridge >= 2.0.0-beta.0** (Matter support required)
- **Node.js >= 22.12.0** (or >= 24.0.0)
- A Dreame vacuum connected to the Dreamehome app
- Matter enabled in Homebridge

## Compatibility

This plugin is developed and tested primarily with a **Dreame L10s Ultra Gen 2** (`dreame.vacuum.r2469x`). Other Dreame models that expose compatible Dreame Cloud, MQTT, and MIoT properties may work, but some model-specific states or commands can differ.

## Installation

```bash
npm install homebridge-dreame-vacuum-matter
```

Or search for `homebridge-dreame-vacuum-matter` in the Homebridge UI.

### Pairing With Apple Home

Homebridge publishes each robot as an **external Matter accessory**, with its own
QR/manual pairing code. In Apple Home, add the vacuum using that robot's code from
Homebridge's Matter accessory information or external-accessory startup logs.
Do **not** reuse the main Matter bridge code or the HAP/HomeKit code. Pairing the
main bridge alone does not pair the vacuum. HAP is not required for vacuum control;
it is only used by the optional automation helpers.

Use current Apple software; [robot vacuum support was introduced in iOS 18.4](https://support.apple.com/en-ie/121161).
If pairing still times out with the correct code, check IPv6/mDNS reachability between
Homebridge, the iPhone and the home hub, including any container/VLAN/firewall rules.
Each external robot uses a separate Matter port assigned by Homebridge; discovery
alone does not prove that port is reachable. Do not reset the robot or delete all
Homebridge storage as a first troubleshooting step.

When reporting a timeout, include Homebridge, plugin, Node, iOS and hub versions,
installation type (native/Docker), and the `[Matter/External]` and `[Matter/Server]`
logs around the attempt. Redact pairing codes, credentials, tokens and personal data.

## Configuration

```json
{
  "platforms": [
    {
      "platform": "DreameVacuumMatter",
      "name": "Dreame Vacuum",
      "username": "your@email.com",
      "password": "your-password",
      "country": "eu"
    }
  ]
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `username` | — | Dreame/Dreamehome app email. Overridable via `DREAME_EMAIL` env var |
| `password` | — | Dreame/Dreamehome app password. Overridable via `DREAME_PASSWORD` env var |
| `country` | `eu` | Cloud region: `cn`, `eu`, `us`, `sg`, `kr`, `ru` |
| `deviceSelection` | `all` | Expose `all` robots, only `selected` IDs, or `none` |
| `deviceIds` | `[]` | Robot IDs to expose when `deviceSelection` is `selected`; an empty list exposes none |
| `automationContactSensors` | `false` | Create HomeKit contact sensors for Apple Home automations. Disabling later removes these sensors |
| `automationDockSwitch` | `false` | Create a momentary HomeKit switch that sends the vacuum back to its dock |
| `mapOverrides` | `[]` | Replace discovered floor/map and room names, optionally scoped by device ID |

In Homebridge's plugin Settings, enter your account details and click **Load robots**.
The list shows each robot by its Dreamehome name, with checkboxes. Uncheck a robot to
switch to **Only the robots checked below**, or choose **All robots** / **No robots**.
Save and restart Homebridge to apply. Loading the list alone does not change the selection.
Names can change without breaking selection because stable IDs are stored internally.
Server-side `DREAME_EMAIL` / `DREAME_PASSWORD` variables are also supported for discovery;
credentials and cloud tokens are never returned with the device list. The picker only
queries the account: it does not start cleaning or change robot settings.

For advanced JSON configuration, the equivalent selection is:

```json
"deviceSelection": "selected",
"deviceIds": ["your-robot-id"]
```

Use `all` (the default) for every robot in the account, or `none` to expose no robots.
Save the configuration and restart Homebridge. Excluding an already published robot also
removes its optional automation accessories. It does not delete the robot or settings from
Dreamehome. Re-enabling a removed robot may require pairing it in Apple Home again and
restoring its room/automation assignments; this is not a temporary visibility toggle.
Unknown selected IDs or an empty cloud discovery leave cached accessories unchanged.
If a saved selection is missing from the fetched list, the UI preserves it until you
explicitly uncheck it. For manual configuration, use IDs, not display names; the startup
log lists each robot's ID. Changes to other plugin settings preserve the robot selection.

Automatic and Quiet cleaning profiles are always available; no experimental setting is needed.
For vacuum-only, Automatic uses normal suction with CleanGenius off. For vacuum-and-mop,
Automatic uses CleanGenius when the robot supports it, or normal manual combined cleaning
on known models without CleanGenius. Quiet uses minimum suction
with CleanGenius off for either cleaning type. Mop-only remains manual.
Older configurations containing `experimentalCleaningProfiles` are accepted; the value is ignored.

Manual cleaning uses the cleaning mode selected in Apple Home. If CleanGenius is active,
the plugin disables it before starting so automatic cleaning cannot override that mode.
CleanGenius stays off afterwards until combined Automatic is selected or it is re-enabled in Dreamehome.

Automatic means
normal vacuuming (standard suction, CleanGenius off) under Vacuum, but enables CleanGenius
under Vacuum and Mop when supported. Known models without CleanGenius use normal manual
combined cleaning instead. Unknown models must confirm CleanGenius support before it is used.
CleanGenius chooses the task settings when active.
Quiet uses minimum suction and disables CleanGenius for both vacuum-only and combined
cleaning, without changing the selected cleaning type. Mop-only remains manual.
The previous beta's mode ID 3 remains supported as a combined-cleaning alias so Matter
can restore its stored mode without resetting the accessory or its pairing.
After updating, verify the profile list in Apple Home; an existing pairing may retain the old
list and require removing and pairing the Matter accessory again. The underlying mode and
suction commands were tested on an L10s Ultra Gen 2. The new profile combinations have
automated regression coverage; their presentation in Apple Home still requires verification.

Model/firmware capabilities and legacy-state rules are adapted from the MIT-licensed
Home Assistant Dreame integration. See [capability behavior and provenance](docs/capabilities.md).
The imported model list is not a list of physically tested Homebridge models. The M1
still needs user confirmation of pairing, tank/mop behavior and basic controls.

For multiple floors, the active map is read from Dreame's `curr_id`, not inferred
from the first saved map. Before a room task the plugin refreshes this information.
If the chosen rooms belong to another floor, it requests that map and confirms it
is active before starting. The robot must already be physically on the intended floor.
Rooms from different maps cannot be combined in a single task. If the map change
fails or cannot be confirmed, cleaning is not started. Older robots that do not
report the selected map may not support this workflow.

Room names can be overridden using the segment and map IDs printed in debug logs:

```json
"mapOverrides": [
  {
    "mapId": 10,
    "name": "Ático",
    "rooms": [
      {
        "segmentId": "3",
        "name": "Cocina"
      },
      {
        "segmentId": "1",
        "name": "Despacho"
      }
    ]
  }
]
```

## Privacy

This plugin does not collect analytics, telemetry, usage metrics, or tracking data. It connects to Dreame Cloud only for authentication, device discovery, commands, and MQTT state updates. See [PRIVACY.md](PRIVACY.md) for details.

## Troubleshooting

- **No devices found**: verify the configured region matches the region used in the Dreamehome app.
- **Matter API is unavailable**: verify you are running Homebridge v2 with Matter enabled.
- **Login failed**: check the account email, password, and region. If credentials are set via environment variables, `DREAME_EMAIL` and `DREAME_PASSWORD` override the Homebridge UI values.
- **MQTT unavailable**: the plugin automatically falls back to HTTP polling if the device does not expose an MQTT endpoint.
- **Rooms/areas are not shown**: enable debug logging and check whether the Dreame cloud returned a map list and room segments for the robot.

## Architecture

```
┌─────────────────────────────────────────┐
│     Apple Home / Matter Controller      │
└────────────────┬────────────────────────┘
                 │  Matter (RoboticVacuumCleaner)
┌────────────────┴────────────────────────┐
│  Homebridge v2 + homebridge-dreame-     │
│  vacuum-matter plugin                   │
└────────┬────────────────┬───────────────┘
         │ HTTP (commands)│ MQTTS (state)
    ┌────┴──────┐    ┌────┴──────────┐
    │DreameCloud│    │  DreameMQTT   │
    │(REST API) │    │  (Push State) │
    └────┬──────┘    └────┬──────────┘
         └───────┬────────┘
     ┌───────────┴──────────────┐
     │   Dreame Cloud Servers   │
     │  iot.dreame.tech:13267   │
     └──────────────────────────┘
```

## Development

```bash
npm run build        # Compile TypeScript
npm run watch        # Watch mode
npm run lint         # Lint source and tests
npm test             # Run tests
npm run type-check   # Type check without emitting
```

## Release Checklist

This repository is prepared for Homebridge verification, but releases are still manual:

1. Run `npm run lint`, `npm run type-check`, `npm run vitest`, and `npm run build`.
2. Update `CHANGELOG.md`.
3. Create a GitHub release with release notes.
4. Publish the package to npm.

## License

Apache-2.0
