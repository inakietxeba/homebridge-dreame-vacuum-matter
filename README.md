# homebridge-dreame-vacuum-matter

Matter-native Homebridge v2 plugin for Dreame vacuum robots.

Connects to **Dreame Cloud** for authentication and device commands, and subscribes to **MQTT** for real-time state updates — exactly like the Dreamehome app.

## Features

- **Matter-native**: Exposes your Dreame vacuum as a Matter RoboticVacuumCleaner device
- **Real-time state**: MQTT push from Dreame Cloud (battery, cleaning state, errors)
- **Cleaning modes**: Sweep, Mop, Sweep & Mop — selectable from Apple Home
- **Operational states**: Running, Paused, Docked, Charging, Seeking Charger, Error
- **Room support**: ServiceArea cluster with room selection (when configured)
- **Auto token refresh**: Seamless credential management with Dreame Cloud

## Requirements

- **Homebridge >= 2.0.0-beta.0** (Matter support required)
- **Node.js >= 22.12.0** (or >= 24.0.0)
- A Dreame vacuum connected to the Dreamehome app

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
npm test             # Run tests
npm run type-check   # Type check without emitting
```

## License

Apache-2.0
