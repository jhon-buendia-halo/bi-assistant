#!/usr/bin/env node
// Packages the desktop app for the brand BRAND names (ADR-0045; default halo).
//
//   node scripts/electron-dist.mjs [electron-builder args…]
//
// The static "build" section of package.json is Halo's; this adds the selected
// brand's app id, OS name, installer name and icon as `-c.<key>=<value>`
// overrides and hands everything else (e.g. `--mac dmg`, `--win nsis --x64`)
// through to electron-builder. It does not build the renderer or stage the
// backend: `npm run electron:dist` does that first. Unit tests:
// node --test frontend/scripts/electron-dist.test.mjs
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrand } from './brand.mjs';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** The electron-builder `-c.<key>=<value>` overrides for one brand.json. */
export function brandBuilderArgs(config) {
  for (const key of ['appId', 'osName', 'artifactName', 'icon']) {
    if (typeof config[key] !== 'string' || config[key].trim() === '') {
      throw new Error(`brand.json "${config.id}" has no ${key}.`);
    }
  }
  return [
    `-c.appId=${config.appId}`,
    `-c.productName=${config.osName}`,
    `-c.artifactName=${config.artifactName}`,
    `-c.icon=${config.icon}`,
    `-c.mac.icon=${config.icon}`,
    `-c.win.icon=${config.icon}`,
  ];
}

/** The full electron-builder argument list: brand overrides, then the caller's args. */
export function electronBuilderArgs(config, extraArgs = []) {
  return [...brandBuilderArgs(config), ...extraArgs];
}

function main(argv) {
  const { id, config } = resolveBrand();
  const args = electronBuilderArgs(config, argv);
  console.log(`[electron-dist] packaging "${id}" (${config.osName})`);
  // electron-builder's own CLI under this Node, with no shell (what `npx
  // electron-builder` runs): on Windows npx is a .cmd that needs one, and
  // cmd.exe would split "Halo Workbench" at its spaces.
  const cli = require.resolve('electron-builder/cli.js');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: frontendRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[electron-dist] ${error.message}`);
    process.exit(1);
  }
}
