# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of this plugin.

## Published Dependencies

The plugin bundles its tested production dependencies, including transitive dependencies, in the published tarball using `bundleDependencies`. `package.json` also declares minimum tested versions for direct runtime dependencies. Development dependencies are not bundled. `package-lock.json` records the source tree used to build the package but is not itself published.

Before releasing, install from the lockfile with `npm ci`, audit production dependencies and verify the packed plugin in both a clean consumer project and an upgrade from an older dependency tree. A clean source checkout alone does not verify an existing Homebridge installation. Bundled versions require ongoing maintenance and a new release for security updates; a passing audit only covers advisories known at that time. Other plugins can retain their own vulnerable copies independently.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory or by contacting the maintainer through the repository.

Do not include Dreame account credentials, access tokens, MQTT credentials, Homebridge pairing data, or full debug logs in public issues.

## Credential Handling

This plugin reads Dreame credentials from Homebridge configuration or from the `DREAME_EMAIL` and `DREAME_PASSWORD` environment variables. It uses those credentials only to authenticate with Dreame Cloud and does not send them to any third-party analytics or telemetry service.
