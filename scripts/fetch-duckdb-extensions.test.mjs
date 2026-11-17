// node --test scripts/fetch-duckdb-extensions.test.mjs (roadmap 1.31.2)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  extensionPath,
  extensionUrl,
  fetchExtensions,
  hostPlatform,
  readDuckdbVersion,
} from './fetch-duckdb-extensions.mjs';

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-ext-'));
}

test('reads the DuckDB version from the lockfile and strips the binding suffix', () => {
  const dir = scratch();
  const lock = path.join(dir, 'package-lock.json');
  fs.writeFileSync(lock, JSON.stringify({ packages: { 'node_modules/@duckdb/node-bindings': { version: '1.5.2-r.2' } } }));
  assert.equal(readDuckdbVersion(lock), '1.5.2');
  fs.writeFileSync(lock, JSON.stringify({ packages: {} }));
  assert.throws(() => readDuckdbVersion(lock), /does not pin/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the real lockfile pins a plain version', () => {
  assert.match(readDuckdbVersion(), /^\d+\.\d+\.\d+$/);
});

test('builds the URL and the per-platform path', () => {
  assert.equal(
    extensionUrl('1.5.2', 'osx_arm64'),
    'https://extensions.duckdb.org/v1.5.2/osx_arm64/excel.duckdb_extension.gz',
  );
  assert.equal(
    extensionPath('out', '1.5.2', 'windows_amd64'),
    path.join('out', 'v1.5.2', 'windows_amd64', 'excel.duckdb_extension'),
  );
});

test('maps the host to DuckDB platform names', () => {
  assert.equal(hostPlatform('win32', 'x64'), 'windows_amd64');
  assert.equal(hostPlatform('darwin', 'arm64'), 'osx_arm64');
  assert.equal(hostPlatform('linux', 'x64'), 'linux_amd64');
  assert.equal(hostPlatform('freebsd', 'x64'), undefined);
});

test('gunzips each platform, skips a same-size file and fails on a failed download', async () => {
  const dir = scratch();
  const body = Buffer.from('extension-bytes');
  let calls = 0;
  const get = async () => { calls++; return zlib.gzipSync(body); };
  const [file] = await fetchExtensions(['osx_arm64'], dir, '1.5.2', get);
  assert.deepEqual(fs.readFileSync(file), body);
  fs.utimesSync(file, new Date(0), new Date(0));
  await fetchExtensions(['osx_arm64'], dir, '1.5.2', get);
  assert.equal(fs.statSync(file).mtimeMs, 0, 'same-size file is not rewritten');
  assert.equal(calls, 2);
  await assert.rejects(
    fetchExtensions(['linux_amd64'], dir, '1.5.2', async () => { throw new Error('answered 404'); }),
    /404/,
  );
  await assert.rejects(fetchExtensions(['beos_ppc'], dir, '1.5.2', get), /Unknown platform/);
  fs.rmSync(dir, { recursive: true, force: true });
});
