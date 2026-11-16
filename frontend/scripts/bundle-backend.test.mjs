// node --test frontend/scripts/bundle-backend.test.mjs (roadmap 1.7.23)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {
  EXTERNAL_PACKAGES,
  copyAssets,
  installedPackages,
  isExternalPackage,
  packageOfInput,
  packagesWithNativeAddons,
  pruneToClosure,
  rewriteModulePaths,
  runtimeClosure,
  thirdPartyLicences,
} from './bundle-backend.mjs';

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-backend-test-'));
}

function writeFile(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function addPackage(nodeModules, name, { dependencies, optionalDependencies, files = {} } = {}) {
  const dir = path.join(nodeModules, name);
  writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', license: 'MIT', dependencies, optionalDependencies }),
  );
  for (const [file, content] of Object.entries(files)) writeFile(path.join(dir, file), content);
  return dir;
}

test('external packages match by exact name or by a trailing-* prefix', () => {
  assert.equal(isExternalPackage('better-sqlite3'), true);
  assert.equal(isExternalPackage('@duckdb/node-bindings-win32-x64'), true);
  assert.equal(isExternalPackage('@github/copilot-sdk'), true);
  assert.equal(isExternalPackage('@github/copilot-sdk-win32-x64'), true);
  assert.equal(isExternalPackage('@databricks/databricks-sql-kernel-win32-x64-msvc'), true);
  assert.equal(isExternalPackage('better-sqlite3-helper'), false);
  assert.equal(isExternalPackage('@databricks/sql'), false);
  assert.equal(isExternalPackage('@mastra/core'), false);
  assert.ok(EXTERNAL_PACKAGES.includes('pino'));
});

test('the closure follows dependencies the way Node resolves them, nested copies first', () => {
  const nm = path.join(scratch(), 'node_modules');
  addPackage(nm, 'better-sqlite3', { dependencies: { bindings: '*' } });
  addPackage(nm, 'bindings', { dependencies: { 'file-uri-to-path': '*' } });
  addPackage(nm, 'file-uri-to-path');
  addPackage(nm, '@github/copilot-sdk', { dependencies: { zod: '*' }, optionalDependencies: { '@github/copilot-sdk-win32-x64': '*' } });
  // copilot-sdk's own zod is nested: the top-level zod belongs to the bundle.
  addPackage(path.join(nm, '@github/copilot-sdk', 'node_modules'), 'zod');
  addPackage(nm, 'zod');
  addPackage(nm, 'lodash');
  // An optional platform package that is not installed is skipped.
  const keep = runtimeClosure(nm);
  assert.deepEqual([...keep].sort(), ['@github/copilot-sdk', 'better-sqlite3', 'bindings', 'file-uri-to-path']);
});

test('pruning removes unkept packages and empty scopes, and keeps listed data files', () => {
  const nm = path.join(scratch(), 'node_modules');
  addPackage(nm, 'better-sqlite3');
  addPackage(nm, 'lodash', { files: { 'index.js': '' } });
  addPackage(nm, '@nestjs/core', { files: { 'index.js': '' } });
  addPackage(nm, '@mastra/core', {
    files: { 'dist/index.cjs': 'code', 'dist/provider-registry.json': '{"a":1}' },
  });
  writeFile(path.join(nm, '.bin', 'tool'), '');
  writeFile(path.join(nm, '.package-lock.json'), '{}');

  const removed = pruneToClosure(nm, new Set(['better-sqlite3']), {
    '@mastra/core': ['package.json', 'dist/provider-registry.json'],
  });

  assert.equal(removed, 3);
  assert.deepEqual(installedPackages(nm), ['@mastra/core', 'better-sqlite3']);
  assert.equal(fs.existsSync(path.join(nm, '@nestjs')), false);
  assert.equal(fs.existsSync(path.join(nm, '.bin')), false);
  assert.equal(fs.existsSync(path.join(nm, '.package-lock.json')), false);
  assert.equal(fs.readFileSync(path.join(nm, '@mastra/core/dist/provider-registry.json'), 'utf8'), '{"a":1}');
  assert.equal(fs.existsSync(path.join(nm, '@mastra/core/dist/index.cjs')), false);
});

test('pruning fails loudly when a data file to keep is missing', () => {
  const nm = path.join(scratch(), 'node_modules');
  addPackage(nm, '@mastra/core');
  assert.throws(
    () => pruneToClosure(nm, new Set(), { '@mastra/core': ['package.json', 'dist/provider-registry.json'] }),
    /@mastra\/core has no dist\/provider-registry.json/,
  );
});

test('finds packages that ship a native addon, nested folders included', () => {
  const nm = path.join(scratch(), 'node_modules');
  addPackage(nm, 'better-sqlite3', { files: { 'build/Release/better_sqlite3.node': '' } });
  addPackage(nm, '@duckdb/node-bindings-win32-x64', { files: { 'duckdb.node': '' } });
  addPackage(nm, 'lodash', { files: { 'index.js': '' } });
  assert.deepEqual(packagesWithNativeAddons(nm), ['@duckdb/node-bindings-win32-x64', 'better-sqlite3']);
});

test('__dirname and __filename keep pointing at the file’s own place in dist/', () => {
  const source = 'const a = join(__dirname, "skills"); const b = __filename; const c = "my__dirname";';
  const rewritten = rewriteModulePaths(source, path.join('mastra', 'app-skills.js'));
  const run = (code) =>
    vm.runInNewContext(`${code}; ({ a, b, c })`, {
      join: path.posix.join,
      require: () => path.posix,
      __dirname: '/app/dist',
    });
  assert.deepEqual({ ...run(rewritten) }, {
    a: '/app/dist/mastra/skills',
    b: '/app/dist/mastra/app-skills.js',
    c: 'my__dirname',
  });
  // A file at the root of dist/ keeps the bundle's own __dirname.
  assert.equal(rewriteModulePaths('x(__dirname)', 'app-bootstrap.js'), 'x(__dirname)');
  assert.equal(rewriteModulePaths('no paths here', 'a/b.js'), 'no paths here');
});

test('copies assets with their layout and leaves code, maps and declarations behind', () => {
  const root = scratch();
  const from = path.join(root, 'compiled');
  for (const file of [
    'main.js', 'main.js.map', 'main.d.ts', 'tsconfig.build.tsbuildinfo',
    'mastra/skills/sql/SKILL.md', 'modules/testing-data/fixtures/001.sql.gz', 'modules/x.service.js',
  ]) {
    writeFile(path.join(from, file), 'x');
  }
  const to = path.join(root, 'dist');
  assert.equal(copyAssets(from, to), 2);
  assert.ok(fs.existsSync(path.join(to, 'mastra/skills/sql/SKILL.md')));
  assert.ok(fs.existsSync(path.join(to, 'modules/testing-data/fixtures/001.sql.gz')));
  assert.equal(fs.existsSync(path.join(to, 'main.js')), false);
  assert.equal(fs.existsSync(path.join(to, 'modules/x.service.js')), false);
});

test('maps a bundled input to its package folder, and first-party code to none', () => {
  assert.equal(packageOfInput('node_modules/lodash/index.js'), path.join('node_modules', 'lodash'));
  assert.equal(
    packageOfInput('node_modules/@mastra/core/dist/index.cjs'),
    path.join('node_modules', '@mastra', 'core'),
  );
  assert.equal(
    packageOfInput('node_modules/@mastra/arize/node_modules/@opentelemetry/api/build/index.js'),
    path.join('node_modules', '@mastra', 'arize', 'node_modules', '@opentelemetry', 'api'),
  );
  assert.equal(packageOfInput('.dist-compiled/main.js'), null);
});

test('collects the licence text of every bundled package once', () => {
  const staging = scratch();
  const nm = path.join(staging, 'node_modules');
  addPackage(nm, 'lodash', { files: { LICENSE: 'MIT lodash text', 'index.js': '' } });
  addPackage(nm, '@scope/pkg', { files: { 'licence.md': 'scope licence', license: '' } });
  // A directory named like a licence file is not read.
  fs.rmSync(path.join(nm, '@scope/pkg/license'));
  fs.mkdirSync(path.join(nm, '@scope/pkg/license'));
  addPackage(nm, 'nolicence', { files: { 'index.js': '' } });
  const text = thirdPartyLicences(staging, [
    'node_modules/lodash/index.js',
    'node_modules/lodash/fp.js',
    'node_modules/@scope/pkg/index.js',
    'node_modules/nolicence/index.js',
    '.dist-compiled/main.js',
  ]);
  assert.equal(text.match(/lodash@1\.0\.0 \(MIT\)/g).length, 1);
  assert.match(text, /MIT lodash text/);
  assert.match(text, /@scope\/pkg@1\.0\.0 \(MIT\)\n\nscope licence/);
  assert.match(text, /nolicence@1\.0\.0 \(MIT\)\n\n\(no licence file shipped\)/);
});
