# homebridge-dreame-vacuum-matter

Matter-native Homebridge v2 plugin for Dreame vacuum robots.

Connects to **Dreame Cloud** for authentication and device commands, and subscribes to **MQTT** for real-time state updates — exactly like the Dreamehome app.

## Features

- **Matter-native**: Exposes your Dreame vacuum as a Matter RoboticVacuumCleaner device
- **Real-time state**: MQTT push from Dreame Cloud (battery, cleaning state, errors)
- **Cleaning modes**: Sweep, Mop, Sweep & Mop — selectable from Apple Home
- **Operational states**: Running, Paused, Docked, Charging, Seeking Charger, Error
- **Optional automation sensors**: Disabled by default; exposes HomeKit contact sensors for Idle, Busy, Cleaning, and Error states
- **Identify support**: Locate/identify command is forwarded to compatible Dreame models
- **Auto token refresh**: Seamless credential management with Dreame Cloud

## Requirements

- **Homebridge >= 2.0.0-beta.0** (Matter support required)
- **Node.js >= 22.12.0** (or >= 24.0.0)
- A Dreame vacuum connected to the Dreamehome app
- Matter enabled in Homebridge

## Installation

```bash
npm install homebridge-dreame-vacuum-matter
```

Or search for `homebridge-dreame-vacuum-matter` in the Homebridge UI.

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
| `automationContactSensors` | `false` | Expose HomeKit contact sensors for Apple Home automations |

## Privacy

This plugin does not collect analytics, telemetry, usage metrics, or tracking data. It connects to Dreame Cloud only for authentication, device discovery, commands, and MQTT state updates. See [PRIVACY.md](PRIVACY.md) for details.

## Troubleshooting

- **No devices found**: verify the configured region matches the region used in the Dreamehome app.
- **Matter API is unavailable**: verify you are running Homebridge v2 with Matter enabled.
- **Login failed**: check the account email, password, and region. If credentials are set via environment variables, `DREAME_EMAIL` and `DREAME_PASSWORD` override the Homebridge UI values.
- **MQTT unavailable**: the plugin automatically falls back to HTTP polling if the device does not expose an MQTT endpoint.
- **Rooms/areas are not shown**: Dreame's cloud endpoints used by this plugin do not currently expose a reliable room/map list, so Matter `ServiceArea` is intentionally disabled.

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
