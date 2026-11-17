#!/usr/bin/env node
// Download DuckDB's `excel` extension so the app ships it (ADR-0052, roadmap
// 1.31.2, delivery.md 2). Node built-ins only.
//
//   node scripts/fetch-duckdb-extensions.mjs <platform…> --out <dir>
//
// Platforms: windows_amd64, osx_arm64, osx_amd64, linux_amd64. Writes
// <dir>/v<version>/<platform>/excel.duckdb_extension, where <version> is the
// DuckDB version in backend/package-lock.json (the `-r.N` binding suffix
// stripped). A file already there with the same size is kept; any status other
// than 200 fails.
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLATFORMS = ['windows_amd64', 'osx_arm64', 'osx_amd64', 'linux_amd64'];
export const EXTENSION_FILE = 'excel.duckdb_extension';

/** The DuckDB version (`1.5.2`) the backend's lockfile pins, without the `-r.N` suffix. */
export function readDuckdbVersion(lockPath = path.join(root, 'backend', 'package-lock.json')) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const raw = lock.packages?.['node_modules/@duckdb/node-bindings']?.version;
  if (!raw) throw new Error(`${lockPath} does not pin @duckdb/node-bindings`);
  return raw.replace(/-r\.\d+$/, '');
}

export function extensionUrl(version, platform) {
  return `https://extensions.duckdb.org/v${version}/${platform}/${EXTENSION_FILE}.gz`;
}

/** The file `platform`'s extension is written to under `outDir`. */
export function extensionPath(outDir, version, platform) {
  return path.join(outDir, `v${version}`, platform, EXTENSION_FILE);
}

/** GET `url` (following redirects); resolves to the body, rejects on a non-200. */
function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GET ${url} answered ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Fetch each platform's extension into `outDir`; returns the written (or kept) paths. */
export async function fetchExtensions(platforms, outDir, version = readDuckdbVersion(), get = download) {
  const bad = platforms.filter((p) => !PLATFORMS.includes(p));
  if (bad.length) throw new Error(`Unknown platform ${bad.join(', ')}. Known: ${PLATFORMS.join(', ')}`);
  const paths = [];
  for (const platform of platforms) {
    const target = extensionPath(outDir, version, platform);
    const body = zlib.gunzipSync(await get(extensionUrl(version, platform)));
    if (fs.existsSync(target) && fs.statSync(target).size === body.length) {
      console.log(`= ${platform}: already there (${target})`);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
      console.log(`✓ ${platform}: ${target} (${body.length} bytes)`);
    }
    paths.push(target);
  }
  return paths;
}

/** DuckDB's platform name for this machine, or undefined when it has none. */
export function hostPlatform(platform = process.platform, arch = process.arch) {
  const os = { win32: 'windows', darwin: 'osx', linux: 'linux' }[platform];
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch];
  return os && cpu ? `${os}_${cpu}` : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? argv[outAt + 1] : undefined;
  const platforms = argv.filter((a, i) => a !== '--out' && i !== outAt + 1);
  if (!out || platforms.length === 0) {
    console.error('Usage: node scripts/fetch-duckdb-extensions.mjs <platform…> --out <dir>');
    process.exit(2);
  }
  fetchExtensions(platforms, path.resolve(out)).catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
}
