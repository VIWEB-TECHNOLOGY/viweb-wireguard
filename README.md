# ViWeb WireGuard

A thin, derived Docker template of [wg-easy](https://github.com/wg-easy/wg-easy)
**15.4.0** — a WireGuard VPN server with a web admin UI — whose only change is
an **initial default MTU of 1412** instead of 1420.

This project did not write the UI, authentication or WireGuard management; all of
that is upstream wg-easy. It adds a pinned base image, a fail-closed build-time
patch of one upstream SQL migration, a hardened Compose file and tests. See
[UPSTREAM.md](UPSTREAM.md) for attribution, the exact source diff and how to
rebuild it. Not affiliated with WireGuard® or wg-easy.

License: **AGPL-3.0-only** (same as upstream, see [LICENSE](LICENSE)).

## Requirements

- Linux Docker host whose kernel already provides WireGuard (Linux ≥ 5.6, or
  the module loaded by the host). The container only gets `NET_ADMIN`; it does
  **not** get `SYS_MODULE`, `/lib/modules`, host networking or privileged mode,
  and never loads kernel modules.
- Docker Engine with Compose 2.20.2 or newer (for
  [`start_interval`](https://docs.docker.com/reference/compose-file/services/#healthcheck)).
- A public hostname or IP for clients, and the WireGuard UDP port (default
  `51820/udp`) open in the host and cloud firewall. Opening ports and firewall
  rules is your decision and your action; nothing here changes them.
- For IPv6 inside the VPN: Docker IPv6 bridge support plus working IPv6 egress
  on the host. Without it, configure clients for IPv4 only.

Tested on a local arm64 Linux Docker VM: image build, authenticated settings,
restart persistence, IPv4/IPv6 tunnel traffic and forwarded IPv4 egress.
The amd64 manifest of the pinned digest exists but amd64 runtime is untested.
Rootless Docker and Docker Desktop (macOS/Windows) are not supported deployment
targets; VM networking and public UDP reachability require separate validation.

## Quickstart

```sh
cp .env.example .env          # optional: ports and Docker subnets only, no secrets
docker compose build
docker compose up -d
```

The admin UI is published on **127.0.0.1 only** (`WG_UI_PORT`, default 51821).
From your workstation, open an SSH tunnel and browse locally:

```sh
ssh -N -L 51821:127.0.0.1:51821 user@your-server
# then open http://127.0.0.1:51821
```

On first visit the wg-easy onboarding asks you to create the admin account and
enter the host (your public hostname, e.g. `vpn.example.com`) and port. No
credentials are bundled or preset. Enter the same UDP port as `WG_PORT`
(default 51820). If you change `WG_PORT`, Compose maps the same port on host and
container; also check **Admin Panel > Interface > Port** and
**Admin Panel > Config > Port** match it.

All state (SQLite database `wg-easy.db`, WAL files, server and client keys)
lives in the named volume `wireguard-data` mounted at `/etc/wireguard`.
Keep exported profiles and QR codes outside the repository, or in the ignored
`client-profiles/` directory. They contain private keys.

The Compose healthcheck requires both the UI responding and `wg0` up. Upstream
brings up `wg0` as part of setup, so the container may report unhealthy until
onboarding is completed.

## MTU 1412 is an initial default only

The patch changes the two seed values in a fresh database:

| Setting | Where to change it in the UI | Upstream page |
| --- | --- | --- |
| Server interface MTU | Admin Panel > Interface > MTU | `src/app/pages/admin/interface.vue` |
| Default MTU for **new** clients | Admin Panel > Config > MTU | `src/app/pages/admin/config.vue` |

Each existing client keeps its own MTU (edit it on the client's page). After
changing MTUs, re-download or re-scan the client profiles; already imported
profiles do not update themselves.

- After saving the **server interface** MTU, use **Restart interface** on the
  Interface page to apply it. This briefly interrupts connected clients; keep
  an independent administration connection available.
- Values you set in the UI are stored in the persistent database and survive
  container restarts and recreation with the same volume. Review migrations
  before upgrading upstream versions. Nothing overwrites them at runtime:
  there is no `WG_MTU`
  variable (legacy, unsupported in wg-easy v15) and no startup SQL update.
- Existing peers are never mass-updated.
- An existing volume (for example from plain wg-easy) is **not** forced to 1412;
  migrations that already ran are not re-run.

### How the patch works

At **build time only**, `scripts/patch-default-mtu.mjs` checks that upstream's
`0001_classy_the_stranger.sql` has the exact pinned SHA-256, replaces exactly
two `1420` seed values with `1412`, and verifies the output hash. Any upstream
drift fails the build. A base-image upgrade therefore requires reviewing the
migration and updating the patch (see UPSTREAM.md); back up first.

## Optional HTTPS reverse proxy

If you already run Caddy or Nginx with a normal TLS certificate on the same
host, proxy to the loopback port. Keep the UI port bound to 127.0.0.1; do not
publish plain HTTP admin access. `INSECURE=true` is acceptable only because the
backend is loopback (proxy on the same host or SSH tunnel). Restricting access
further (VPN-only, IP allowlist) is recommended.

Caddy:

```caddyfile
vpn-admin.example.com {
	reverse_proxy 127.0.0.1:51821
}
```

Nginx (inside an existing `server { listen 443 ssl; ... }` with your certificate):

```nginx
server_name vpn-admin.example.com;
location / {
    proxy_pass http://127.0.0.1:51821;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
}
```

## Backup and restore

Back up the whole volume while the container is **stopped** so the SQLite
database and its WAL files are consistent. The archive contains private keys:
encrypt it and store it with restricted access.

```sh
docker compose stop
umask 077
mkdir -p backups
chmod 700 backups
docker run --rm --entrypoint tar \
  -v viweb-wireguard_wireguard-data:/etc/wireguard:ro \
  viweb-wireguard:15.4.0-mtu1412 -czf - -C /etc/wireguard . \
  > backups/wireguard-data.tar.gz
tar -tzf backups/wireguard-data.tar.gz >/dev/null
docker compose start
# then encrypt, e.g.: age -r <recipient> -o wireguard-data.tar.gz.age backups/wireguard-data.tar.gz
# and delete the plaintext archive
```

Restore offline into a **fresh** volume (for example on a new host, before the
first `up`):

```sh
docker compose build
docker volume create viweb-wireguard_wireguard-data
docker run --rm -i --entrypoint tar \
  -v viweb-wireguard_wireguard-data:/etc/wireguard \
  viweb-wireguard:15.4.0-mtu1412 -xzf - -C /etc/wireguard \
  < backups/wireguard-data.tar.gz
docker compose up -d
```

These volume names assume the default Compose project name. If you use `-p`,
confirm the actual volume name before backing up or restoring. Restore only
after checking the archive and confirming that the destination volume is fresh.

Never use `docker compose down -v` as a routine command: it deletes the volume
with all keys and clients.

## Limitations

- This is a VPN server template, not a guarantee against DNS, IPv6 or other
  leaks on every client or network.
- Security of the admin UI and WireGuard handling is upstream's; follow wg-easy
  releases. See [SECURITY.md](SECURITY.md).
- No migration tooling for other WireGuard setups and no automatic firewall,
  DNS or cloud changes.

## Contributing

Run `node --test tests/*.test.mjs` (Node 24; `node:sqlite` may print an
experimental warning) and `docker compose config` before proposing changes.
Keep the project thin: changes to upstream behaviour beyond the MTU seed belong
upstream in wg-easy.

### Validation on October 14, 2026

- All 16 unit/configuration tests passed; the pinned arm64 image built.
- Real application onboarding/login and unauthorized-admin rejection passed.
- Fresh server/client defaults were 1412. Changing the server to 1380, the
  client default to 1360 and an existing client to 1340 persisted after restart.
  New clients used 1360; an existing client's MTU stayed unchanged until edited.
- Profile download, QR generation, invalid-MTU rejection and the healthcheck
  passed. API checks exercised the same endpoints used by the upstream UI;
  no independent browser rendering check was performed.
- An isolated Docker client completed a WireGuard handshake, IPv4 and IPv6
  tunnel pings, and IPv4 forwarding/NAT pings, with two packets each and no loss.

These checks used disposable containers and volumes, not a production gateway.
Public Internet ingress, IPv6 Internet egress, throughput, amd64 runtime and a
live-host migration remain untested. CI builds and tests; it does not publish.
