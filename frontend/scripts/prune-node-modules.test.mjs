// node --test frontend/scripts/prune-node-modules.test.mjs (roadmap 1.7.22)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isPrunableFile,
  isPrunableDir,
  isUntouchedPackage,
  pruneNodeModules,
} from './prune-node-modules.mjs';

test('prunes declarations, source maps, TypeScript sources, docs and lint configs', () => {
  for (const name of [
    'index.d.ts', 'index.d.mts', 'index.d.cts', 'index.ts', 'util.mts', 'util.cts',
    'index.js.map', 'index.mjs.map', 'index.cjs.map', 'styles.css.map', 'index.d.ts.map',
    'README.md', 'CHANGELOG.md', 'guide.mdx', 'HISTORY.markdown',
    '.eslintrc', '.eslintrc.json', '.nycrc', '.prettierrc.yml', '.editorconfig',
    '.travis.yml', '.npmignore', '.gitattributes', '.jshintrc', '.babelrc',
  ]) {
    assert.equal(isPrunableFile(name), true, name);
  }
});

test('keeps runtime code, data and licence files', () => {
  for (const name of [
    'index.js', 'index.mjs', 'index.cjs', 'package.json', 'binding.node', 'duckdb.dll',
    'LICENSE', 'LICENSE.md', 'license.markdown', 'LICENCE.txt', 'NOTICE.md', 'COPYING.md',
    'types.map', 'data.json', 'schema.yml', 'tsconfig.json', 'index.tsv',
  ]) {
    assert.equal(isPrunableFile(name), false, name);
  }
});

test('prunes test and CI folders only', () => {
  assert.equal(isPrunableDir('__tests__'), true);
  assert.equal(isPrunableDir('.github'), true);
  for (const name of ['test', 'tests', 'docs', 'lib', 'dist']) assert.equal(isPrunableDir(name), false, name);
});

test('leaves the Copilot SDK packages whole', () => {
  assert.equal(isUntouchedPackage('@github/copilot-sdk'), true);
  assert.equal(isUntouchedPackage('@github/copilot-sdk-win32-x64'), true);
  assert.equal(isUntouchedPackage('@github/other'), false);
  assert.equal(isUntouchedPackage('copilot-sdk'), false);
});

function write(root, rel, text = 'x') {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

test('walks a node_modules tree, nested and scoped packages included', () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qti-prune-')), 'node_modules');
  const kept = [
    '.package-lock.json',
    '.bin/tool.md',
    'a/index.js',
    'a/LICENSE.md',
    'a/lib/data.map',
    '@s/b/dist/index.cjs',
    '@s/b/node_modules/c/index.js',
    '@github/copilot-sdk/README.md',
    '@github/copilot-sdk-win32-x64/agents/plan.md',
    '@github/copilot-sdk-win32-x64/lib/run.ts',
  ];
  const pruned = [
    'a/README.md',
    'a/index.d.ts',
    'a/index.js.map',
    'a/.eslintrc.json',
    '@s/b/src/index.ts',
    '@s/b/node_modules/c/index.d.ts',
    '@s/b/node_modules/c/CHANGELOG.md',
  ];
  for (const rel of [...kept, ...pruned]) write(root, rel);
  write(root, 'a/__tests__/a.test.js');
  write(root, 'a/.github/workflows/ci.yml');

  const removed = pruneNodeModules(root);

  for (const rel of kept) assert.equal(fs.existsSync(path.join(root, rel)), true, `kept ${rel}`);
  for (const rel of pruned) assert.equal(fs.existsSync(path.join(root, rel)), false, `pruned ${rel}`);
  assert.equal(fs.existsSync(path.join(root, 'a/__tests__')), false);
  assert.equal(fs.existsSync(path.join(root, 'a/.github')), false);
  assert.deepEqual(removed, { files: pruned.length, dirs: 2 });
});
