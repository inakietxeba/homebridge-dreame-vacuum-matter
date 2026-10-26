# Issue Follow-Up Drafts

These replies have not been posted. Version `1.0.5` is prepared locally;
post the drafts below only after publishing it to npm with the `latest` tag.

## #2: Multiple Maps

Thanks for reporting this. I found two problems: the plugin treated the first saved
map as active, and it did not refresh that information before starting a room task.
Saved-map IDs could also be confused with IDs in the inline map frames.

Version **1.0.5** includes a fix that reads the selected map reported by Dreame. When rooms
belong to a different map, it requests that map and verifies the change before
starting. It still refuses to mix floors or start if the map change is not confirmed.
The robot needs to be physically on the floor you selected.

Please update to **1.0.5** and test selecting rooms on a
non-first floor and changing the selected map in Dreamehome while Homebridge is
running. We should keep this issue open until that works on your robot.

## #3: Pairing Timeout

Thanks for the details. One important point: Homebridge publishes the vacuum as a
separate external Matter accessory with its own QR/manual pairing code. The code
for the main Matter bridge must not be reused for the vacuum. Enabling HAP or adding
the HAP bridge is not required to pair the vacuum.

Version **1.0.5** also adds model-specific capability
handling. Known M1 models without CleanGenius use normal manual combined cleaning
instead. Please update to that version before testing. This does not by itself
prove that the pairing timeout is fixed.

Please try the vacuum's own code from Homebridge's Matter accessory information or
the external-accessory startup logs. This is the first thing to check, rather than
assuming your Trouver/Mova model is incompatible.

If it still times out, please share your Homebridge, plugin, Node, iOS and home hub
software versions, whether you use Docker or separate VLANs, and the
`[Matter/External]` / `[Matter/Server]` logs around the attempt. Please redact all
pairing codes, credentials and tokens. The timeout cause and compatibility of this
model are not yet confirmed, so we should leave the issue open while checking this.
