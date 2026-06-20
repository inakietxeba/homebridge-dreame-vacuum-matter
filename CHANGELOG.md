# Changelog

All notable changes to this project will be documented in this file.

## 1.0.2

- Added an optional momentary HomeKit switch for return-to-dock actions in classic automations.
- Fixed the Dreame charging-service ID used by return-to-dock commands.
- Kept Matter run mode and operational state aligned after start, stop, resume, and return-to-dock commands.
- Published the returning-home state immediately when the classic HomeKit dock switch is triggered.
- Prevented partial MQTT messages from indefinitely postponing the HTTP state fallback.
- Parsed Dreame Cloud MQTT property updates nested inside the `data` envelope.
- Reset the automation switch to off after both successful and failed dock commands.
- Deferred the switch reset until HomeKit finishes committing the trigger write.
- Added automatic registration and cleanup of the optional switch when its setting changes.

## 1.0.1

- Added Matter room selection and customized segment cleaning across discovered Dreame maps.
- Added expanded Dreame state parsing, cleaning-mode handling, and optional automation sensors.
- Fixed segment-cleaning payloads for newer models and surfaced failed Dreame actions.
- Prevented room selections from mixing maps or targeting a map other than the active one.
- Kept duplicate room segment IDs associated with the correct Matter map and area.
- Reported Matter room skipping as unsupported instead of clearing the active selection.

## 1.0.0

- Initial Matter-native Homebridge v2 plugin for Dreame vacuum robots.
- Added Dreame Cloud authentication and command support.
- Added MQTT state updates with HTTP polling fallback.
- Added Matter robotic vacuum clusters for run mode, clean mode, operational state, and power state.
- Added Homebridge Plugin Settings GUI schema.
