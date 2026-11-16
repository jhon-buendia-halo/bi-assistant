#!/usr/bin/env node
// Build-time brand selection (ADR-0045). BRAND=halo|mercer, default halo.
//
//   node scripts/brand.mjs id                 prints the selected brand id
//   node scripts/brand.mjs ng-build [args…]   ng build for that brand: the base
//                                             options are Halo; another brand
//                                             adds its configuration on top
//                                             (`-c production,mercer`). Writes
//                                             dist/frontend/browser/brand.json.
//   node scripts/brand.mjs electron-prepare   copies brands/<id>/brand.json to
//                                             electron/brand.json for main.cjs
//
// Each brand lives in brands/<id>/: brand.json (OS name, app id, installer
// name, window title, canvas colours, icon), tokens.css, public/ and art/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BRAND = 'halo';

/** The brands that have a folder with a brand.json. */
export function listBrands(root = frontendRoot) {
  const dir = path.join(root, 'brands');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'brand.json')))
    .map((entry) => entry.name)
    .sort();
}

/** The brand BRAND names (default halo), with its brand.json; throws on an unknown id. */
export function resolveBrand(env = process.env, root = frontendRoot) {
  const id = (env.BRAND ?? '').trim() || DEFAULT_BRAND;
  const known = listBrands(root);
  if (!known.includes(id)) {
    throw new Error(`Unknown BRAND "${id}". Known brands: ${known.join(', ')}.`);
  }
  const dir = path.join(root, 'brands', id);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'brand.json'), 'utf8'));
  if (config.id !== id) throw new Error(`brands/${id}/brand.json has id "${config.id}".`);
  return { id, dir, config };
}

/** The Angular configuration list for a production build of `id`. */
export function ngConfiguration(id) {
  return id === DEFAULT_BRAND ? 'production' : `production,${id}`;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: frontendRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main(argv) {
  const [command, ...rest] = argv;
  const brand = resolveBrand();
  switch (command) {
    case 'id':
      console.log(brand.id);
      return;
    case 'ng-build': {
      run('npx', ['ng', 'build', '-c', ngConfiguration(brand.id), ...rest]);
      const out = path.join(frontendRoot, 'dist', 'frontend', 'browser', 'brand.json');
      fs.writeFileSync(out, `${JSON.stringify({ id: brand.id }, null, 2)}\n`);
      console.log(`[brand] built the web UI for "${brand.id}"`);
      return;
    }
    case 'electron-prepare': {
      const out = path.join(frontendRoot, 'electron', 'brand.json');
      fs.copyFileSync(path.join(brand.dir, 'brand.json'), out);
      console.log(`[brand] electron/brand.json is "${brand.id}"`);
      return;
    }
    default:
      console.error('usage: node scripts/brand.mjs id | ng-build [args…] | electron-prepare');
      process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[brand] ${error.message}`);
    process.exit(1);
  }
}
