# Upstream, attribution and corresponding source

ViWeb WireGuard is a derived work of **wg-easy** by its contributors,
<https://github.com/wg-easy/wg-easy>, licensed under the GNU Affero General
Public License v3.0 only. The full upstream license is in [LICENSE](LICENSE).
The web UI, API, authentication and WireGuard management are entirely upstream.

## Pinned upstream

| Item | Value |
| --- | --- |
| Version | 15.4.0 |
| Source commit | [`2f9751e302acf78fd560417fd2dfbf224b2174c8`](https://github.com/wg-easy/wg-easy/tree/2f9751e302acf78fd560417fd2dfbf224b2174c8) |
| Base image | `ghcr.io/wg-easy/wg-easy:15.4.0@sha256:0e7bc9d34e86ddcaa92bc700d4d7dc9b33291dbc07ac8d13382f7c2095f949ec` (multi-arch amd64/arm64) |
| Patched file (source) | [`src/server/database/migrations/0001_classy_the_stranger.sql`](https://github.com/wg-easy/wg-easy/blob/2f9751e302acf78fd560417fd2dfbf224b2174c8/src/server/database/migrations/0001_classy_the_stranger.sql) |
| Patched file (image) | `/app/server/database/migrations/0001_classy_the_stranger.sql` |
| SHA-256 before | `814271c6d4daec80a2de04f0aa29d9a5f1b689f51db3d9a575443942233f4c11` |
| SHA-256 after | `3e572a11e4a62f5ae01b39b8e0f690ce276747bc12516b29e8b02219497e09d8` |

The pinned file is also kept as `tests/fixtures/0001_classy_the_stranger.sql`.

## Modification

The only change to upstream code: in that migration's seed data, the two
values `1420` are replaced with `1412`:

- `interfaces_table.mtu` (server interface MTU)
- `user_configs_table.default_mtu` (default MTU for new clients)

No other byte changes. Entrypoint, CMD, environment, ports, healthcheck and
application code of the base image are unchanged. The modification is applied by
[`scripts/patch-default-mtu.mjs`](scripts/patch-default-mtu.mjs) during
`docker build` (see [`Dockerfile`](Dockerfile)).

To reproduce the diff from source:

```sh
git clone https://github.com/wg-easy/wg-easy && cd wg-easy
git checkout 2f9751e302acf78fd560417fd2dfbf224b2174c8
cp src/server/database/migrations/0001_classy_the_stranger.sql /tmp/orig.sql
cp /tmp/orig.sql /tmp/patched.sql
node /path/to/viweb-wireguard/scripts/patch-default-mtu.mjs /tmp/patched.sql
diff -u /tmp/orig.sql /tmp/patched.sql
```

## Building

```sh
docker compose build        # or: docker build -t viweb-wireguard:15.4.0-mtu1412 .
```

The complete corresponding source of the running image is the upstream commit
above plus this repository. If you run a modified version as a network service,
AGPL section 13 requires offering your users its source.

## Upgrading the base image

1. Back up the volume (README, "Backup and restore").
2. Pin the new version **by digest**; never `latest` or `edge`.
3. Review upstream migrations and release notes: whether the seed is still in
   `0001_classy_the_stranger.sql`, still `1420`, and whether any later
   migration changes MTU defaults.
4. Update the fixture, both hashes and anchors in the patch script, then the
   tests. The build fails closed until this is done.
