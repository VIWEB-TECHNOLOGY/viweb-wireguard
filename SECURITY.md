# Security

## Reporting

- Vulnerabilities in the web UI, API, authentication or WireGuard handling are
  upstream wg-easy issues: report them through wg-easy's security policy at
  <https://github.com/wg-easy/wg-easy/security>.
- Issues specific to this template (Dockerfile, patch script, Compose
  defaults, docs) can be reported privately to this repository's maintainers via
  the hosting platform's private vulnerability reporting. Do not post keys,
  configs or databases in public issues.

## Deployment defaults

- Admin UI bound to `127.0.0.1` only; reach it through an SSH tunnel or a TLS
  reverse proxy on the same host. `INSECURE=true` is only safe with that
  loopback binding; never publish the UI over plain HTTP.
- Only `NET_ADMIN`. No privileged mode, `SYS_MODULE`, `/lib/modules`, host
  network or kernel module loading.
- No bundled credentials; the admin account is created during onboarding.
- The `wireguard-data` volume and backups contain private keys. Encrypt
  backups and restrict access.
- Base image pinned by digest. Upgrades require reviewing the patch
  (UPSTREAM.md) and should follow upstream security releases promptly.

No claim is made of protection against DNS, IPv6 or other client-side leaks.
