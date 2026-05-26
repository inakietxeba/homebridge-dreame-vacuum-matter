# Privacy

This plugin does not collect analytics, telemetry, usage metrics, or tracking data.

## Network Access

The plugin connects directly to Dreame Cloud endpoints for:

- account authentication
- device discovery
- device commands
- real-time MQTT state updates

No plugin data is intentionally sent to services other than Dreame Cloud and the local Homebridge/Matter runtime.

## Local Data

The plugin does not create its own persistent cache, database, or key store. Homebridge may store plugin configuration, cached accessories, and Matter pairing data in the normal Homebridge storage directory.

## Credentials

Dreame credentials are read from the Homebridge configuration UI or from the `DREAME_EMAIL` and `DREAME_PASSWORD` environment variables. Do not share debug logs publicly if they may contain credentials, tokens, device IDs, or account details.
