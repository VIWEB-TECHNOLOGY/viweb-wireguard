// Exposure and hardening bounds of compose.yaml, the Dockerfile and the build
// context. Uses `docker compose config` (no containers started) when Docker is
// available; the static checks always run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const hasCompose = spawnSync('docker', ['compose', 'version']).status === 0;

const PUBLISHED = 'ghcr.io/viweb-technology/viweb-wireguard:15.4.0-mtu1412';
const LOCAL = 'viweb-wireguard:15.4.0-mtu1412';
const SOURCE = ['compose.yaml', 'compose.build.yaml'];

function composeConfig(env = {}, files = ['compose.yaml']) {
  const args = ['compose', ...files.flatMap((f) => ['-f', join(ROOT, f)]), 'config', '--format', 'json'];
  const r = spawnSync('docker', args, {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, WG_PORT: '', WG_UI_PORT: '', ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).services['wg-easy'];
}

function assertBounds(svc, { udp, ui }) {
  const tcp = svc.ports.filter((p) => p.protocol === 'tcp');
  assert.equal(tcp.length, 1, 'exactly one TCP port');
  assert.equal(tcp[0].host_ip, '127.0.0.1', 'admin UI must be loopback-only');
  assert.equal(String(tcp[0].published), String(ui));
  assert.equal(tcp[0].target, 51821);

  const u = svc.ports.filter((p) => p.protocol === 'udp');
  assert.equal(u.length, 1);
  assert.equal(String(u[0].published), String(udp));
  assert.equal(String(u[0].target), String(udp), 'UDP host and container port must match');

  assert.deepEqual(svc.cap_add, ['NET_ADMIN']);
  assert.ok(!svc.privileged);
  assert.ok(!svc.network_mode);
  assert.ok(!(svc.volumes ?? []).some((v) => String(v.source).startsWith('/lib/modules')));
  assert.equal(svc.volumes.find((v) => v.target === '/etc/wireguard')?.type, 'volume');
  assert.equal(svc.restart, 'unless-stopped');
  assert.equal(svc.logging.driver, 'json-file');
  assert.equal(svc.environment.INSECURE, 'true');
  for (const k of ['WG_MTU', 'PASSWORD', 'INIT_PASSWORD', 'INIT_ENABLED', 'HOST']) {
    assert.ok(!(k in svc.environment), `${k} must not be set`);
  }
  assert.equal(svc.sysctls['net.ipv4.ip_forward'], '1');
  assert.equal(svc.sysctls['net.ipv6.conf.all.forwarding'], '1');
  assert.ok(svc.healthcheck.test.join(' ').includes('wg show wg0'));
}

test('compose defaults: loopback UI, UDP 51820, NET_ADMIN only', { skip: !hasCompose && 'docker compose not available' }, () => {
  assertBounds(composeConfig(), { udp: 51820, ui: 51821 });
});

test('compose overrides keep loopback and matching UDP ports', { skip: !hasCompose && 'docker compose not available' }, () => {
  assertBounds(composeConfig({ WG_PORT: '443', WG_UI_PORT: '8443' }), { udp: 443, ui: 8443 });
});

test('default compose pulls the published image and never builds', { skip: !hasCompose && 'docker compose not available' }, () => {
  const svc = composeConfig();
  assert.equal(svc.image, PUBLISHED);
  assert.ok(!('build' in svc), 'default compose must not build');
  assert.ok(!svc.pull_policy || svc.pull_policy !== 'build');
});

test('source override builds a local tag and keeps all bounds', { skip: !hasCompose && 'docker compose not available' }, () => {
  const svc = composeConfig({}, SOURCE);
  assert.equal(svc.build?.context?.replace(/\/$/, ''), ROOT.replace(/\/$/, ''));
  assert.equal(svc.image, LOCAL, 'local tag must not shadow the registry image');
  assert.equal(svc.pull_policy, 'build');
  assertBounds(svc, { udp: 51820, ui: 51821 });
  assertBounds(composeConfig({ WG_PORT: '443', WG_UI_PORT: '8443' }, SOURCE), { udp: 443, ui: 8443 });
});

test('static: source override only adds build settings', () => {
  const lines = read('compose.build.yaml').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.deepEqual(lines.map((l) => l.trim()), ['services:', 'wg-easy:', 'build: .', `image: ${LOCAL}`, 'pull_policy: build']);
});

test('static: compose has no public admin bind and no forbidden settings', () => {
  const c = read('compose.yaml').replace(/#.*$/gm, '');
  assert.match(c, /"127\.0\.0\.1:\$\{WG_UI_PORT:-51821\}:51821\/tcp"/);
  assert.doesNotMatch(c, /0\.0\.0\.0|SYS_MODULE|privileged|network_mode|\/lib\/modules|WG_MTU|PASSWORD/);
});

test('static: Dockerfile pins the digest and keeps upstream entrypoint/CMD', () => {
  const d = read('Dockerfile');
  const from = d.match(/^FROM .*$/gm);
  assert.deepEqual(from, ['FROM ghcr.io/wg-easy/wg-easy:15.4.0@sha256:0e7bc9d34e86ddcaa92bc700d4d7dc9b33291dbc07ac8d13382f7c2095f949ec']);
  assert.doesNotMatch(d, /^\s*(CMD|ENTRYPOINT|ENV|EXPOSE|USER|HEALTHCHECK)\b/m);
  assert.doesNotMatch(d.replace(/^\s*#.*$/gm, ''), /\b(latest|edge)\b/);
});

test('static: build context excludes everything except the patch script', () => {
  const lines = read('.dockerignore').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['*', '!scripts/patch-default-mtu.mjs']);
  const gi = read('.gitignore');
  for (const p of ['.env', '*.conf', '*.db']) assert.ok(gi.split('\n').includes(p), p);
});

test('static: .env.example holds no secrets', () => {
  const keys = read('.env.example').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => l.split('=')[0]);
  assert.deepEqual(keys.sort(), ['WG_DOCKER_IPV4_SUBNET', 'WG_DOCKER_IPV6_SUBNET', 'WG_PORT', 'WG_UI_PORT']);
});
