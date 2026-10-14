# SPDX-License-Identifier: AGPL-3.0-only
#
# ViWeb WireGuard: a thin derived image of wg-easy 15.4.0 (https://github.com/wg-easy/wg-easy).
# The only change is the initial MTU seed (1420 -> 1412) in one upstream SQL
# migration. Entrypoint, CMD, ports, environment and healthcheck are upstream's.
# See UPSTREAM.md before changing the base image.

# wg-easy 15.4.0 (multi-arch: linux/amd64, linux/arm64). Never use latest/edge.
FROM ghcr.io/wg-easy/wg-easy:15.4.0@sha256:0e7bc9d34e86ddcaa92bc700d4d7dc9b33291dbc07ac8d13382f7c2095f949ec

COPY scripts/patch-default-mtu.mjs /opt/viweb-wireguard/patch-default-mtu.mjs

# Fails the build if the upstream migration is not byte-identical to the pinned version.
RUN node /opt/viweb-wireguard/patch-default-mtu.mjs /app/server/database/migrations/0001_classy_the_stranger.sql \
 && node /opt/viweb-wireguard/patch-default-mtu.mjs --verify-patched /app/server/database/migrations/0001_classy_the_stranger.sql

LABEL org.opencontainers.image.title="ViWeb WireGuard" \
      org.opencontainers.image.description="wg-easy 15.4.0 with an initial default MTU of 1412 (UI-editable)" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/VIWEB-TECHNOLOGY/viweb-wireguard" \
      org.opencontainers.image.base.name="ghcr.io/wg-easy/wg-easy:15.4.0" \
      org.opencontainers.image.base.digest="sha256:0e7bc9d34e86ddcaa92bc700d4d7dc9b33291dbc07ac8d13382f7c2095f949ec"
