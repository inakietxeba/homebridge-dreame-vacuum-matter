# Changelog

All notable changes to this project will be documented in this file.

## 1.0.6 - 2026-11-09

- Fix Matter accessory registration by reporting the return to dock as the operational state, not as a run mode with missing tags.
- Leave confirmation of external Matter publication to Homebridge, which can report a failure even when the registration API call resolves.
- Prevent Matter registration errors from duplicate or overlong map and room names and malformed Dreame battery readings.
- Reject unsupported run commands and invalid room selections instead of reporting success or clearing the selection.
- Keep room IDs and command routing aligned when the active map changes, and stop room tasks if a selected segment no longer exists.
- Do not report HTTP polling recovery until Dreame returns usable property values.
- Bundle tested production dependencies, including MQTT's corrected `ip-address` dependency, so tarball installations and upgrades use the corrected copies shipped with this plugin.
- Raised the minimum MQTT dependency to the locally tested 5.15.1 release. Direct runtime dependency minimums now match the tested versions.

- Added a per-robot map and room name editor that loads Dreame names and preserves saved overrides when discovery fails.
- Fixed map discovery routing and clarified that robots must be powered on and connected to the internet.
- Improved settings contrast and added external Matter accessory pairing instructions to settings and documentation.
- Added concise per-robot logs, change-only debug state summaries and optional privacy-filtered extended diagnostics.
- Limited repeated connection and Matter synchronization warnings, with a single recovery summary and safe authentication errors.
- Removed startup pairing reminders and sensitive cloud response details from plugin logs.
- Updated runtime dependencies and test tooling to resolve known npm security advisories, including Zod, MQTT's transitive IP parser and Vitest.
- Removed repeated robot names from scoped session and Matter registration log messages.

## 1.0.6-beta.5 - 2026-10-28

- Report MQTT authentication failures once at error level without logging the response contents.

## 1.0.6-beta.4 - 2026-10-27

- Restricted Matter area-selection debug logging to validated area IDs.

## 1.0.6-beta.3 - 2026-10-27

- Added per-robot log context, compact change-only state logging and opt-in extended diagnostics restricted to safe numeric properties.
- Reduced repeated connectivity and Matter synchronization warnings, and report recovery without changing retry behavior.
- Removed repeated pairing guidance from startup; pairing instructions remain in plugin settings.

## 1.0.6-beta.2 - 2026-10-27

- Simplified startup logs: pairing guidance stays in plugin settings instead of repeating on every startup, map discovery logs counts instead of full naming configuration, and technical identifiers stay in debug output. Removed private cloud response bodies from errors.
- Clarified that map discovery needs the robot powered on, online and available in Dreamehome, including specific guidance when cloud requests cannot reach the robot.

## 1.0.6-beta.1 - 2026-10-26

- Fixed map editor discovery to initialize per-device cloud routing before reading maps. Failure messages now identify the operation that failed without exposing cloud response data.

## 1.0.6-beta.0 - 2026-10-26

- Added a robot-specific map and room name editor that loads existing Dreame names without changing the robot. Preserves saved overrides on discovery failures and scopes edits by robot, map and room.
- Improved custom settings text contrast and added step-by-step Apple Home pairing instructions.

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
