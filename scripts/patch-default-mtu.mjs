#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
//
// Build-time patch for the wg-easy 15.4.0 initial-values migration.
//
// Changes exactly two seed values in
//   /app/server/database/migrations/0001_classy_the_stranger.sql
// (upstream: https://github.com/wg-easy/wg-easy/blob/2f9751e302acf78fd560417fd2dfbf224b2174c8/src/server/database/migrations/0001_classy_the_stranger.sql)
//
//   interfaces_table.mtu               1420 -> 1412
//   user_configs_table.default_mtu     1420 -> 1412
//
// The migration only runs when a database is created for the first time, so
// this sets the INITIAL default only. Values changed later in the web UI are
// stored in the database and are never touched by this script or the image.
//
// Fails closed: the input must match the exact upstream SHA-256, each anchor
// must occur exactly once, and the result must differ from the input only at
// the expected bytes and match the expected output SHA-256.
//
// Usage:
//   node patch-default-mtu.mjs <path-to-0001.sql>          patch in place
//   node patch-default-mtu.mjs --verify-patched <path>     check only

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const UPSTREAM_SHA256 =
  '814271c6d4daec80a2de04f0aa29d9a5f1b689f51db3d9a575443942233f4c11';
export const PATCHED_SHA256 =
  '3e572a11e4a62f5ae01b39b8e0f690ce276747bc12516b29e8b02219497e09d8';

const FROM = '1420';
const TO = '1412';

// Each anchor contains the value to change; it must appear exactly once.
const ANCHORS = [
  "'fdcc:ad94:bacf:61a4::cafe:0/112', 1420, 1);",
  "VALUES ('wg0', 1420, 0, '[\"1.1.1.1\",\"2606:4700:4700::1111\"]'",
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function fail(msg) {
  console.error(`patch-default-mtu: ERROR: ${msg}`);
  process.exit(1);
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + 1);
  }
  return count;
}

export function patch(input) {
  const inHash = sha256(input);
  if (inHash !== UPSTREAM_SHA256) {
    throw new Error(
      `input SHA-256 ${inHash} does not match pinned upstream ${UPSTREAM_SHA256}; ` +
        'upstream changed - review the migration and update this patch deliberately'
    );
  }
  const text = input.toString('utf8');
  if (countOccurrences(text, FROM) !== ANCHORS.length) {
    throw new Error(`expected exactly ${ANCHORS.length} occurrences of ${FROM}`);
  }

  let out = text;
  const expectedOffsets = [];
  for (const anchor of ANCHORS) {
    const n = countOccurrences(out, anchor);
    if (n !== 1) throw new Error(`anchor found ${n} times (expected 1): ${anchor}`);
    const at = out.indexOf(anchor);
    const valueAt = at + anchor.indexOf(FROM);
    for (let k = 0; k < FROM.length; k++) {
      if (FROM[k] !== TO[k]) expectedOffsets.push(valueAt + k);
    }
    out = out.slice(0, valueAt) + TO + out.slice(valueAt + FROM.length);
  }

  const output = Buffer.from(out, 'utf8');
  if (output.length !== input.length) throw new Error('output length changed');
  const changed = [];
  for (let i = 0; i < input.length; i++) if (input[i] !== output[i]) changed.push(i);
  if (JSON.stringify(changed) !== JSON.stringify(expectedOffsets.sort((a, b) => a - b))) {
    throw new Error(`unexpected changed byte offsets: ${changed.join(',')}`);
  }
  if (countOccurrences(out, FROM) !== 0) throw new Error(`${FROM} still present`);
  const outHash = sha256(output);
  if (outHash !== PATCHED_SHA256) {
    throw new Error(`output SHA-256 ${outHash} does not match expected ${PATCHED_SHA256}`);
  }
  return output;
}

function main(argv) {
  if (argv[0] === '--verify-patched' && argv.length === 2) {
    const h = sha256(readFileSync(argv[1]));
    if (h !== PATCHED_SHA256) fail(`${argv[1]} SHA-256 ${h} is not the expected patched ${PATCHED_SHA256}`);
    console.log(`patch-default-mtu: verified patched migration (${h})`);
    return;
  }
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    fail('usage: patch-default-mtu.mjs <file> | --verify-patched <file>');
  }
  const file = argv[0];
  let output;
  try {
    output = patch(readFileSync(file));
  } catch (e) {
    fail(e.message);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, output);
  renameSync(tmp, file);
  console.log(`patch-default-mtu: patched ${file} (initial MTU ${FROM} -> ${TO}, ${sha256(output)})`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
