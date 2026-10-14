// Simulates wg-easy's apply-once migration flow in SQLite (node:sqlite) to show
// that the patched seed affects only NEW databases and that values changed later
// (as the web UI does) survive restarts and image upgrades.
//
// The real migrator is drizzle-orm/libsql: it records applied migrations in
// __drizzle_migrations and only applies migrations newer than the last applied
// one. This test models that rule with a small table; it does not replace the
// container-level runtime test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURE = join(ROOT, 'tests/fixtures/0001_classy_the_stranger.sql');

function patchedSql() {
  const file = join(mkdtempSync(join(tmpdir(), 'viweb-wg-')), '0001.sql');
  copyFileSync(FIXTURE, file);
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/patch-default-mtu.mjs'), file]);
  assert.equal(r.status, 0, String(r.stderr));
  return readFileSync(file, 'utf8');
}
const upstreamSql = () => readFileSync(FIXTURE, 'utf8');

// Minimal stand-in for 0000_short_skin.sql (table creation). Untyped columns
// are enough for SQLite to accept upstream's INSERT statements unchanged.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS __migrations (tag TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS general_table (setup_step, session_password, session_timeout, metrics_prometheus, metrics_json);
CREATE TABLE IF NOT EXISTS interfaces_table (name PRIMARY KEY, device, port, private_key, public_key, ipv4_cidr, ipv6_cidr, mtu, enabled);
CREATE TABLE IF NOT EXISTS hooks_table (id PRIMARY KEY, pre_up, post_up, pre_down, post_down);
CREATE TABLE IF NOT EXISTS user_configs_table (id PRIMARY KEY, default_mtu, default_persistent_keepalive, default_dns, default_allowed_ips, host, port);
`;

// One container start: open the DB, apply 0001 if not yet applied, close.
function boot(dbFile, sql0001) {
  const db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  if (!db.prepare('SELECT 1 FROM __migrations WHERE tag = ?').get('0001')) {
    db.exec('BEGIN');
    for (const stmt of sql0001.split('--> statement-breakpoint')) {
      if (stmt.trim() && !/^\s*PRAGMA/i.test(stmt)) db.exec(stmt);
    }
    db.prepare('INSERT INTO __migrations (tag) VALUES (?)').run('0001');
    db.exec('COMMIT');
  }
  const state = {
    mtu: db.prepare("SELECT mtu FROM interfaces_table WHERE name='wg0'").get().mtu,
    defaultMtu: db.prepare("SELECT default_mtu FROM user_configs_table WHERE id='wg0'").get().default_mtu,
    interfaces: db.prepare('SELECT count(*) AS n FROM interfaces_table').get().n,
    userConfigs: db.prepare('SELECT count(*) AS n FROM user_configs_table').get().n,
  };
  db.close();
  return state;
}

function uiChange(dbFile, mtu, defaultMtu) {
  const db = new DatabaseSync(dbFile);
  db.prepare("UPDATE interfaces_table SET mtu = ? WHERE name='wg0'").run(mtu);
  db.prepare("UPDATE user_configs_table SET default_mtu = ? WHERE id='wg0'").run(defaultMtu);
  db.close();
}

const newDb = () => join(mkdtempSync(join(tmpdir(), 'viweb-wg-db-')), 'wg-easy.db');

test('control: unpatched upstream seeds 1420 for both values', () => {
  const s = boot(newDb(), upstreamSql());
  assert.deepEqual([s.mtu, s.defaultMtu], [1420, 1420]);
});

test('fresh database with patched migration seeds 1412 for server and client default', () => {
  const s = boot(newDb(), patchedSql());
  assert.deepEqual([s.mtu, s.defaultMtu, s.interfaces, s.userConfigs], [1412, 1412, 1, 1]);
});

test('UI changes survive restarts (migration is not re-applied)', () => {
  const db = newDb();
  boot(db, patchedSql());
  uiChange(db, 1380, 1360);
  for (let i = 0; i < 3; i++) {
    const s = boot(db, patchedSql());
    assert.deepEqual([s.mtu, s.defaultMtu, s.interfaces, s.userConfigs], [1380, 1360, 1, 1]);
  }
});

test('existing upstream database keeps its values after switching to this image', () => {
  const db = newDb();
  boot(db, upstreamSql());
  const s = boot(db, patchedSql());
  assert.deepEqual([s.mtu, s.defaultMtu], [1420, 1420], 'no mass update of existing installs');
});
