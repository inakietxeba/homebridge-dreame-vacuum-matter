# Changelog

All notable changes to this project will be documented in this file.

## 1.0.5 - 2026-10-26

Stable release validated on an L10s Ultra Gen 2, including startup, Matter registration and MQTT reconnection. M1 compatibility and multi-floor switching still require reporter validation.

- Imported a pinned, MIT-attributed subset of Home Assistant Dreame model/firmware capabilities, without keys or resources. Adapted combined Automatic for known robots without CleanGenius, legacy states, tank/mop checks, mode encoding and segment ordering. Imported model identifiers do not imply verified device compatibility.
- Fixed multi-map discovery to use saved floor IDs and Dreame's reported active map instead of defaulting to the first map. Room starts refresh, select and confirm the target map before sending a cleaning task (#2).
- Added per-robot Matter pairing guidance to settings, startup logs and documentation, with safe timeout troubleshooting (#3; reporter confirmation still required).

- Enabled Automatic and Quiet profiles for all robots and removed the experimental configuration toggle. Existing configurations remain compatible, and all persisted profile IDs stay valid.
- Isolated robot initialization failures so one unavailable device cannot block the others or remove its cached accessories.
- Ignored late HTTP/MQTT updates and Matter synchronization retries after session disposal.

- Added a Homebridge custom settings screen with read-only account discovery and robot-name checkboxes. Selection stores stable IDs, preserves other settings and does not save or remove accessories merely by loading the list.

- Added robot exposure selection: all account robots, selected stable device IDs, or none. Excluded robots are not provisioned and their cached accessories are removed after discovery.

- Kept legacy clean-mode ID 3 valid across upgrades so Matter can restore its persisted mode without failing endpoint initialization.

- Added Automatic and Quiet Matter profiles. Automatic selects standard manual vacuuming for vacuum-only, and CleanGenius for combined cleaning on supported models (normal manual combined cleaning on known models without CleanGenius). Quiet remains manual at minimum suction; mop-only remains manual.
- Applied explicitly selected manual cleaning settings to both whole-home and room starts; basic Start preserves device settings.
- Fixed ignored pauses immediately after start, resume or dock commands.
- Rejected cloud/device errors and missing command results instead of publishing success.
- Retried partial Matter state-push failures without marking failed clusters as synchronized.
- Restored fast HTTP fallback after MQTT transport or subscription failures.
- Preserved Matter area selections independently of repeated Dreame segment IDs across maps.
- Kept rejected suction/water writes out of subsequent room-cleaning payloads.
- Applied the selected cleaning mode before starting a room-cleaning task, including lifting-mop model encoding.
- Disabled active CleanGenius for explicitly selected manual cleaning, confirming the change before starting so it cannot override the selected mode.
- Rejected room starts when Dreame reports an error setting the cleaning mode or disabling CleanGenius.

## 1.0.4

- Fixed the Dreame service/action IDs used by Matter start, pause, and resume commands.
- Scoped action IDs to their MIoT services to prevent invalid service/action combinations.

## 1.0.3

- Fixed the Dreame charging-service ID used by return-to-dock commands.
- Kept Matter run mode and operational state aligned after start, stop, resume, and return-to-dock commands.
- Published the returning-home state immediately when the classic HomeKit dock switch is triggered.
- Prevented partial MQTT messages from indefinitely postponing the HTTP state fallback.
- Parsed Dreame Cloud MQTT property updates nested inside the `data` envelope.
- Preserved error codes that arrive immediately before the matching MQTT error state.
- Deferred the switch reset until HomeKit finishes committing the trigger write.

## 1.0.2

- Added an optional momentary HomeKit switch for return-to-dock actions in classic automations.
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
