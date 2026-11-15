// node --test frontend/scripts/electron-dist.test.mjs (ADR-0045)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandBuilderArgs, electronBuilderArgs } from './electron-dist.mjs';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readBrand = (id) =>
  JSON.parse(fs.readFileSync(path.join(frontendRoot, 'brands', id, 'brand.json'), 'utf8'));

test('overrides app id, product name, installer name and every icon for a brand', () => {
  const config = {
    id: 'acme',
    osName: 'Acme Hub',
    appId: 'com.example.acme',
    artifactName: 'Acme-Hub-${version}-${os}-${arch}.${ext}',
    icon: 'brands/acme/public/brand/icon.png',
  };
  assert.deepEqual(brandBuilderArgs(config), [
    '-c.appId=com.example.acme',
    '-c.productName=Acme Hub',
    '-c.artifactName=Acme-Hub-${version}-${os}-${arch}.${ext}',
    '-c.icon=brands/acme/public/brand/icon.png',
    '-c.mac.icon=brands/acme/public/brand/icon.png',
    '-c.win.icon=brands/acme/public/brand/icon.png',
  ]);
});

test('passes the caller arguments through after the brand overrides', () => {
  const config = readBrand('mercer');
  const args = electronBuilderArgs(config, ['--win', 'nsis', '--x64', '-c.directories.output=/tmp/out']);
  assert.deepEqual(args.slice(-4), ['--win', 'nsis', '--x64', '-c.directories.output=/tmp/out']);
  assert.equal(args.length, 10);
  assert.ok(args.includes('-c.productName=Agentic Hub'));
  assert.ok(args.includes('-c.appId=com.halopowered.agentic-hub'));
  assert.equal(electronBuilderArgs(config).length, 6);
});

test('every shipped brand yields overrides whose icon exists', () => {
  for (const id of ['halo', 'mercer']) {
    const config = readBrand(id);
    const icon = brandBuilderArgs(config).find((arg) => arg.startsWith('-c.icon='));
    assert.ok(fs.existsSync(path.join(frontendRoot, icon.slice('-c.icon='.length))), id);
  }
});

test('the Halo overrides match the static build config in package.json', () => {
  const build = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8')).build;
  const halo = readBrand('halo');
  assert.equal(build.appId, halo.appId);
  assert.equal(build.productName, halo.osName);
  assert.equal(build.artifactName, halo.artifactName);
  assert.equal(build.icon, halo.icon);
  assert.equal(build.mac.icon, halo.icon);
  assert.equal(build.win.icon, halo.icon);
});

test('refuses a brand.json without one of the required fields', () => {
  const config = readBrand('halo');
  for (const key of ['appId', 'osName', 'artifactName', 'icon']) {
    assert.throws(() => brandBuilderArgs({ ...config, [key]: '' }), new RegExp(key));
    const { [key]: _omitted, ...rest } = config;
    assert.throws(() => brandBuilderArgs(rest), new RegExp(key));
  }
});
