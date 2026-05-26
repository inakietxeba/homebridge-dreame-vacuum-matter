# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of this plugin.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory or by contacting the maintainer through the repository.

Do not include Dreame account credentials, access tokens, MQTT credentials, Homebridge pairing data, or full debug logs in public issues.

## Credential Handling

This plugin reads Dreame credentials from Homebridge configuration or from the `DREAME_EMAIL` and `DREAME_PASSWORD` environment variables. It uses those credentials only to authenticate with Dreame Cloud and does not send them to any third-party analytics or telemetry service.
