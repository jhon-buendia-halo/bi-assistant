// node --test frontend/scripts/brand.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BRAND, listBrands, ngConfiguration, resolveBrand } from './brand.mjs';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('lists the brands that have a brand.json', () => {
  assert.deepEqual(listBrands(), ['halo', 'mercer']);
});

test('BRAND unset or blank selects Halo', () => {
  assert.equal(DEFAULT_BRAND, 'halo');
  assert.equal(resolveBrand({}).id, 'halo');
  assert.equal(resolveBrand({ BRAND: '  ' }).id, 'halo');
});

test('BRAND=mercer selects Agentic Hub', () => {
  const brand = resolveBrand({ BRAND: 'mercer' });
  assert.equal(brand.id, 'mercer');
  assert.equal(brand.config.osName, 'Agentic Hub');
  assert.equal(brand.config.publishNpm, false);
});

test('an unknown BRAND is an error that names the known ones', () => {
  assert.throws(() => resolveBrand({ BRAND: 'acme' }), /Unknown BRAND "acme".*halo, mercer/);
});

test('Halo builds the base configuration; another brand adds its own', () => {
  assert.equal(ngConfiguration('halo'), 'production');
  assert.equal(ngConfiguration('mercer'), 'production,mercer');
});

test('every brand.json is complete, points at an existing icon and has its own app id and name', () => {
  const seen = { appId: new Set(), osName: new Set(), artifactName: new Set() };
  for (const id of listBrands()) {
    const { config } = resolveBrand({ BRAND: id });
    for (const key of ['osName', 'windowTitle', 'appId', 'artifactName', 'icon']) {
      assert.equal(typeof config[key], 'string', `${id}: ${key}`);
    }
    assert.match(config.canvas.light, /^#[0-9a-f]{6}$/i);
    assert.match(config.canvas.dark, /^#[0-9a-f]{6}$/i);
    assert.ok(fs.existsSync(path.join(frontendRoot, config.icon)), `${id}: ${config.icon}`);
    for (const key of Object.keys(seen)) {
      assert.ok(!seen[key].has(config[key]), `${id}: ${key} shared with another brand`);
      seen[key].add(config[key]);
    }
  }
});

test('every brand ships the files the shell links to', () => {
  for (const id of listBrands()) {
    for (const file of ['favicon.ico', 'brand/favicon.svg', 'brand/icon.png']) {
      assert.ok(fs.existsSync(path.join(frontendRoot, 'brands', id, 'public', file)), `${id}: ${file}`);
    }
    assert.ok(fs.existsSync(path.join(frontendRoot, 'brands', id, 'tokens.css')), `${id}: tokens.css`);
  }
});
