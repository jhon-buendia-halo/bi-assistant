// node --test backend/scripts/assert-publishable-brand.test.js (ADR-0045)
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkPublishableBrand } = require('./assert-publishable-brand.js');

const realBrandsDir = path.resolve(__dirname, '..', '..', 'frontend', 'brands');

function publicDirWith(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-brand-public-'));
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'brand.json'), content);
  return dir;
}

test('accepts the Halo web UI (publishNpm true)', () => {
  const result = checkPublishableBrand({ publicDir: publicDirWith('{"id":"halo"}'), brandsDir: realBrandsDir });
  assert.equal(result.ok, true, result.message);
});

test('refuses the Mercer web UI (publishNpm false)', () => {
  const result = checkPublishableBrand({ publicDir: publicDirWith('{"id":"mercer"}'), brandsDir: realBrandsDir });
  assert.equal(result.ok, false);
  assert.match(result.message, /mercer/);
  assert.match(result.message, /publishNpm/);
});

test('refuses when the web UI carries no brand marker', () => {
  const result = checkPublishableBrand({ publicDir: publicDirWith(), brandsDir: realBrandsDir });
  assert.equal(result.ok, false);
  assert.match(result.message, /missing/);
});

test('refuses an unknown, malformed or path-like brand id', () => {
  for (const content of ['{"id":"acme"}', '{"id":"../halo"}', '{"id":42}', '{}', 'not json']) {
    const result = checkPublishableBrand({ publicDir: publicDirWith(content), brandsDir: realBrandsDir });
    assert.equal(result.ok, false, content);
  }
});

test('refuses a brand whose publishNpm is missing rather than true', () => {
  const brandsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-brands-'));
  fs.mkdirSync(path.join(brandsDir, 'acme'));
  fs.writeFileSync(path.join(brandsDir, 'acme', 'brand.json'), '{"id":"acme"}');
  const result = checkPublishableBrand({ publicDir: publicDirWith('{"id":"acme"}'), brandsDir });
  assert.equal(result.ok, false);
});

test('the CLI exit code follows the check (0 publishable, 1 refused)', () => {
  // The CLI reads the real backend/public, whatever was built there last.
  const run = spawnSync(process.execPath, [path.join(__dirname, 'assert-publishable-brand.js')], { encoding: 'utf8' });
  const publicMarker = path.resolve(__dirname, '..', 'public', 'brand.json');
  const expected = checkPublishableBrand().ok ? 0 : 1;
  assert.equal(run.status, expected, `${run.stdout}${run.stderr} (${publicMarker})`);
});
