// Calls the real patch script as a subprocess against a temporary copy of the
// verbatim upstream migration (tests/fixtures, AGPL-3.0, from wg-easy 15.4.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/patch-default-mtu.mjs');
const FIXTURE = join(ROOT, 'tests/fixtures/0001_classy_the_stranger.sql');
const sha = (b) => createHash('sha256').update(b).digest('hex');

function tempCopy(content) {
  const file = join(mkdtempSync(join(tmpdir(), 'viweb-wg-')), '0001.sql');
  if (content === undefined) copyFileSync(FIXTURE, file);
  else writeFileSync(file, content);
  return file;
}
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('fixture is the pinned upstream file', () => {
  assert.equal(sha(readFileSync(FIXTURE)), '814271c6d4daec80a2de04f0aa29d9a5f1b689f51db3d9a575443942233f4c11');
});

test('patch changes only the two MTU seed values', () => {
  const file = tempCopy();
  const before = readFileSync(file);
  const r = run(file);
  assert.equal(r.status, 0, r.stderr);
  const after = readFileSync(file);
  assert.equal(after.length, before.length);

  const diffs = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) diffs.push(i);
  assert.equal(diffs.length, 4, 'two digits in each of two values');

  const b = before.toString(), a = after.toString();
  assert.equal(b.split('1420').length - 1, 2);
  assert.equal(a.split('1420').length - 1, 0);
  // Restoring the two values must reproduce the upstream file exactly.
  assert.equal(a.replaceAll(", 1412, 1);", ", 1420, 1);").replace("('wg0', 1412, 0,", "('wg0', 1420, 0,"), b);
  assert.match(a, /'fdcc:ad94:bacf:61a4::cafe:0\/112', 1412, 1\);/);
  assert.match(a, /VALUES \('wg0', 1412, 0, '\["1\.1\.1\.1"/);

  assert.equal(run('--verify-patched', file).status, 0);
});

test('fails closed on any upstream drift and leaves the file untouched', () => {
  const orig = readFileSync(FIXTURE, 'utf8');
  const variants = {
    'whitespace change': orig.replace('PRAGMA', 'PRAGMA '),
    'different MTU upstream': orig.replaceAll('1420', '1280'),
    'extra 1420 occurrence': orig + '\n-- 1420\n',
    'already patched': orig.replaceAll(', 1420, ', ', 1412, '),
    'empty file': '',
  };
  for (const [name, content] of Object.entries(variants)) {
    const file = tempCopy(content);
    const r = run(file);
    assert.notEqual(r.status, 0, `${name}: should fail`);
    assert.match(r.stderr, /ERROR/, name);
    assert.equal(readFileSync(file, 'utf8'), content, `${name}: file modified`);
  }
});

test('running twice fails (no silent double patch)', () => {
  const file = tempCopy();
  assert.equal(run(file).status, 0);
  const patched = readFileSync(file);
  assert.notEqual(run(file).status, 0);
  assert.deepEqual(readFileSync(file), patched);
});

test('verify mode rejects the unpatched upstream file', () => {
  assert.notEqual(run('--verify-patched', tempCopy()).status, 0);
});

test('bad usage and missing file fail', () => {
  assert.notEqual(run().status, 0);
  assert.notEqual(run('/nonexistent/0001.sql').status, 0);
});
