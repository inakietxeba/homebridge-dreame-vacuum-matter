# Device Capabilities

## Source and Updates

The capability snapshot is derived from Tasshack/dreame-vacuum v2.0.0b23,
revision `bba1d35429393b085583fb82cef1ff441e1de98b`.
See THIRD_PARTY_NOTICES.md and third-party/dreame-vacuum-LICENSE.txt (MIT).

Only seven boolean capability firmware thresholds and 628 model identifiers are
imported. Device keys, cloud credentials, map encryption keys, resources, and the
Home Assistant runtime are not imported. This list is NOT a claim that all 628
models have been tested with this Homebridge plugin.

Regenerate from an upstream checkout with:

```sh
python3 scripts/import-ha-capabilities.py /path/to/dreame-vacuum
```

The importer reads committed files at the pinned revision. Updating its pin requires
reviewing upstream capability IDs, firmware semantics, and the source license before
regeneration. Generated thresholds are checked against the device firmware build
(for example, `4.3.9_1036` has build 1036). Unknown firmware cannot enable features
whose minimum build is greater than 1.

## Cleaning Modes

These are Dreame API values, NOT Matter mode IDs:

| Cleaning type | Standard robot | Lifting-mop robot |
| --- | --- | --- |
| Vacuum | 0 | 2 |
| Mop | 1 | 1 |
| Vacuum and mop | 2 | 0 |

Self-wash models can pack other settings into the same property. The codec preserves
those bits, and handles non-lifting self-wash models separately. For known models,
the configured encoding is not guessed from a transient state. Unknown models retain
the existing live-state inference; that is not a substitute for model testing.

Matter IDs 0/1/2/3/4/5 remain valid to protect persisted accessories. Keeping an ID
valid does not guarantee the robot can execute it in every physical state.

- Vacuum Automatic: standard manual suction; CleanGenius disabled if supported.
- Combined Automatic: CleanGenius on supported models; standard manual combined
  cleaning on models the snapshot explicitly identifies as not supporting it.
- Quiet: manual cleaning at minimum suction.
- Mop-only: manual cleaning.
- Unsupported or unconfirmed CleanGenius is not assumed to work on unknown models.

For the M1 (`r2380`, `r2380r`), the snapshot does not enable CleanGenius, mop lifting
or NEW_STATE. For the L10s Ultra Gen 2 (`r2469x`), it enables these capabilities.

## Runtime Checks

The device's initial property results refine cleaning-mode and customized-cleaning
availability. Live tank/mop status prevents vacuum-only on non-lifting models with
the tank installed, and prevents mopping without the tank/mop. An embedded tank is
handled separately. Missing or unsupported tank data is unknown, not "removed".

Basic Start preserves the current app/device settings until a controller explicitly
selects a cleaning mode/profile. It does not require writing an optional cleaning-mode
property. Unsupported explicit mode selections still fail clearly
rather than pretending the requested cleaning type was applied.

Legacy states are translated to canonical states before Matter mapping. Room payloads
use ordered indexes on older non-customized models and preserve the fixed index for
newer/customized devices. MQTT updates refresh command-handler capabilities.

Dedicated Mova/Trouver account authentication, native Matter compatibility and all
other advanced Home Assistant features are outside this import. A matching model
does not prove firmware, map format or command compatibility. Physical testing remains
necessary, particularly for the M1 and multi-floor switching.
