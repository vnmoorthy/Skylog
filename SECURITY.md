# Security policy

## Supported versions

Skylog is a single-branch project; the latest commit on `main` is the supported version.

## Reporting a vulnerability

Please **do not** open a public issue. Instead, email a description of the vulnerability and steps to reproduce to the maintainer (see GitHub profile).

We aim to respond within 48 hours and ship a fix within 7 days for any confirmed issue. Skylog has no backend, no user accounts, and no PII storage — the attack surface is small, but we take security seriously regardless.

## Threat model

- All data is stored client-side in IndexedDB. No server has access.
- Network calls go to: `airplanes.live` (live aircraft), `celestrak.org` (satellite TLEs), `basemaps.cartocdn.com` (map tiles), and the user's `geolocation` API. None of these are sent any user-identifying data.
- No third-party scripts, no cookies, no analytics.
