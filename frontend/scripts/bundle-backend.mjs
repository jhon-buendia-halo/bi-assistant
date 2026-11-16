#!/usr/bin/env node
// Bundles the staged backend into one file and keeps only the packages that
// cannot be bundled (delivery.md section 3, roadmap 1.7.23).
//
//   node frontend/scripts/bundle-backend.mjs <staging dir>
//
// The staging dir holds `dist/` (the tsc output), `package.json` and a
// production `node_modules/`. Afterwards `dist/main.js` is the whole backend
// with its pure-JS dependencies inlined, `dist/` keeps the non-JS assets the
// code reads (skills, fixtures), `dist/THIRD_PARTY_LICENSES.txt` holds the
// licence texts of every inlined package, and `node_modules/` keeps only the
// external packages and what they depend on.
//
// Why: the Windows installer's time grows with its file count (NTFS and
// Defender pay per file); the production node_modules holds ~20,000 files and
// this leaves under 2,000. Unit tests: node --test frontend/scripts/bundle-backend.test.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packages left out of the bundle, with everything they depend on. An entry
 * ending in `*` is a name prefix (it also covers the per-platform packages).
 */
export const EXTERNAL_PACKAGES = [
  // Native addons: `.node` binaries are loaded from their own folders.
  'better-sqlite3',
  '@duckdb/*',
  'libsql',
  '@libsql/*',
  '@databricks/databricks-sql-kernel*',
  'lz4-napi',
  '@antoniomuso/*',
  // Reads its own .md and .ts files and spawns its per-platform binary.
  '@github/copilot-sdk*',
  // Runs transports in worker threads from files next to its own code.
  'pino',
  // Read their own data files through __dirname at runtime (pdfkit's
  // standard fonts, fontkit's tries, quickjs's WASM for Databricks PAC proxies).
  'pdfkit',
  'fontkit',
  '@tootallnate/quickjs-emscripten',
  // Required by name through createRequire at runtime, invisible to esbuild
  // (the AI SDK's and Mastra's safe fetch).
  'undici',
];

/**
 * Bundled packages that read files of their own at runtime by resolving
 * `<package>/package.json`: their folder stays with only these files.
 */
export const PACKAGE_DATA_FILES = {
  '@mastra/core': ['package.json', 'dist/provider-registry.json'],
  '@mastra/observability': ['package.json', 'dist/metrics/pricing-data.jsonl'],
};

/** Optional modules that are required inside a guard and never installed. */
export const ABSENT_OPTIONAL_MODULES = [
  'pg-native',
  '@nestjs/microservices',
  '@nestjs/websockets',
  'class-validator',
  'class-transformer',
  '@fastify/static',
];

/** Files in the tsc output that are code, not assets read at runtime. */
const CODE_FILE = /\.(js|cjs|mjs)(\.map)?$|\.d\.[cm]?ts(\.map)?$|\.tsbuildinfo$/;
const LICENCE_FILE = /^(licen[cs]e|notice|copying)/i;

/** True when an installed package name matches one EXTERNAL_PACKAGES entry. */
export function isExternalPackage(name, patterns = EXTERNAL_PACKAGES) {
  return patterns.some((pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );
}

/** The top-level package names installed in a node_modules dir. */
export function installedPackages(nodeModules) {
  const names = [];
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join(nodeModules, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`);
      }
    } else {
      names.push(entry.name);
    }
  }
  return names.sort();
}

function readPackageJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The top-level packages to keep: the external ones and, transitively, every
 * installed package they depend on, resolved the way Node does (a nested
 * node_modules first, then each parent's).
 */
export function runtimeClosure(nodeModules, patterns = EXTERNAL_PACKAGES) {
  const root = path.resolve(nodeModules);
  const keep = new Set();
  const visited = new Set();
  const queue = installedPackages(root)
    .filter((name) => isExternalPackage(name, patterns))
    .map((name) => path.join(root, name));

  const resolveFrom = (packageDir, dependency) => {
    let dir = packageDir;
    while (dir.startsWith(root)) {
      const candidate = path.join(dir, 'node_modules', dependency);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      if (dir === root) break;
      dir = path.dirname(dir);
    }
    const topLevel = path.join(root, dependency);
    return fs.existsSync(path.join(topLevel, 'package.json')) ? topLevel : null;
  };

  while (queue.length > 0) {
    const dir = queue.pop();
    if (visited.has(dir)) continue;
    visited.add(dir);
    const relative = path.relative(root, dir).split(path.sep);
    keep.add(relative[0].startsWith('@') ? `${relative[0]}/${relative[1]}` : relative[0]);
    const pkg = readPackageJson(dir);
    if (!pkg) continue;
    const dependencies = Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    });
    for (const dependency of dependencies) {
      const resolved = resolveFrom(dir, dependency);
      if (resolved) queue.push(resolved);
    }
  }
  return keep;
}

/** Top-level packages that ship a `.node` binary (nested node_modules included). */
export function packagesWithNativeAddons(nodeModules) {
  const found = [];
  const hasAddon = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() ? hasAddon(full) : entry.name.endsWith('.node')) return true;
    }
    return false;
  };
  for (const name of installedPackages(nodeModules)) {
    if (hasAddon(path.join(nodeModules, name))) found.push(name);
  }
  return found;
}

/**
 * esbuild plugin: in first-party files under `compiledDir`, `__dirname` and
 * `__filename` keep meaning the file's own place in `dist/`, so code that
 * reads an asset next to itself (skills, fixtures, package.json) still finds
 * it once bundled into `dist/main.js`.
 */
export function compiledPathsPlugin(compiledDir) {
  const root = path.resolve(compiledDir);
  return {
    name: 'compiled-paths',
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, (args) => {
        if (!args.path.startsWith(root + path.sep)) return undefined;
        const source = fs.readFileSync(args.path, 'utf8');
        return { contents: rewriteModulePaths(source, path.relative(root, args.path)), loader: 'js' };
      });
    },
  };
}

/** Rewrites `__dirname`/`__filename` relative to the bundle's own directory. */
export function rewriteModulePaths(source, relativeFile) {
  if (!/\b__(dirname|filename)\b/.test(source)) return source;
  const posix = relativeFile.split(path.sep).join('/');
  const dir = path.posix.dirname(posix);
  const dirExpr = dir === '.' ? '__dirname' : `require("path").join(__dirname, ${JSON.stringify(dir)})`;
  const fileExpr = `require("path").join(__dirname, ${JSON.stringify(posix)})`;
  return source
    .replace(/\b__dirname\b/g, '__BUNDLED_DIRNAME__')
    .replace(/\b__filename\b/g, '__BUNDLED_FILENAME__')
    .replace(/__BUNDLED_DIRNAME__/g, dirExpr)
    .replace(/__BUNDLED_FILENAME__/g, fileExpr);
}

/** Copies every non-code file of `from` into `to`, keeping the layout. */
export function copyAssets(from, to) {
  let copied = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copied += copyAssets(source, target);
    } else if (!CODE_FILE.test(entry.name)) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(source, target);
      copied += 1;
    }
  }
  return copied;
}

/**
 * Removes every top-level package not in `keep`, and empty scopes. A package
 * in `dataFiles` keeps only the listed files (paths relative to its folder).
 */
export function pruneToClosure(nodeModules, keep, dataFiles = PACKAGE_DATA_FILES) {
  let removed = 0;
  for (const name of installedPackages(nodeModules)) {
    if (keep.has(name)) continue;
    const dir = path.join(nodeModules, name);
    const files = dataFiles[name];
    if (files) {
      const saved = files.map((file) => {
        const full = path.join(dir, file);
        if (!fs.existsSync(full)) throw new Error(`${name} has no ${file} to keep`);
        return [file, fs.readFileSync(full)];
      });
      fs.rmSync(dir, { recursive: true, force: true });
      for (const [file, content] of saved) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
      }
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    removed += 1;
  }
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    const full = path.join(nodeModules, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory() && fs.readdirSync(full).length === 0) {
      fs.rmdirSync(full);
    }
  }
  // Links and npm's own cache of the old tree: stale once packages are gone.
  fs.rmSync(path.join(nodeModules, '.bin'), { recursive: true, force: true });
  fs.rmSync(path.join(nodeModules, '.package-lock.json'), { force: true });
  return removed;
}

/** The installed package a bundled input file belongs to, or null for first-party code. */
export function packageOfInput(inputPath) {
  const parts = inputPath.split(/[\\/]/);
  const at = parts.lastIndexOf('node_modules');
  if (at === -1 || at + 1 >= parts.length) return null;
  const first = parts[at + 1];
  return first.startsWith('@') ? path.join(...parts.slice(0, at + 3)) : path.join(...parts.slice(0, at + 2));
}

/** One text file with the licence of every package inlined into the bundle. */
export function thirdPartyLicences(stagingDir, inputPaths) {
  const packageDirs = [...new Set(inputPaths.map(packageOfInput).filter(Boolean))].sort();
  const sections = [];
  for (const relativeDir of packageDirs) {
    const dir = path.join(stagingDir, relativeDir);
    const pkg = readPackageJson(dir);
    if (!pkg) continue;
    const licenceFiles = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const texts = licenceFiles.map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim());
    const declared = typeof pkg.license === 'string' ? pkg.license : 'see package';
    sections.push(
      [`${pkg.name}@${pkg.version} (${declared})`, ...(texts.length ? texts : ['(no licence file shipped)'])].join(
        '\n\n',
      ),
    );
  }
  return `Third-party packages bundled into main.js\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`;
}

/** Bundles `<staging>/dist` in place and trims `<staging>/node_modules`. */
export async function bundleStagedBackend(stagingDir, { esbuild, log = console.log } = {}) {
  const staging = path.resolve(stagingDir);
  const dist = path.join(staging, 'dist');
  const compiled = path.join(staging, '.dist-compiled');
  const nodeModules = path.join(staging, 'node_modules');

  const keep = runtimeClosure(nodeModules);
  const unbundledAddons = packagesWithNativeAddons(nodeModules).filter((name) => !keep.has(name));
  if (unbundledAddons.length > 0) {
    throw new Error(
      `native addons outside EXTERNAL_PACKAGES: ${unbundledAddons.join(', ')}. Add them to the list.`,
    );
  }

  fs.rmSync(compiled, { recursive: true, force: true });
  fs.renameSync(dist, compiled);
  const external = [...keep].flatMap((name) => [name, `${name}/*`]).concat(ABSENT_OPTIONAL_MODULES);
  const result = await esbuild.build({
    entryPoints: [path.join(compiled, 'main.js')],
    outfile: path.join(dist, 'main.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Nest and loggers read class names; esbuild would rename clashing ones.
    keepNames: true,
    legalComments: 'none',
    external,
    plugins: [compiledPathsPlugin(compiled)],
    metafile: true,
    logLevel: 'error',
  });
  const assets = copyAssets(compiled, dist);
  const inputs = Object.keys(result.metafile.inputs).map((input) => path.resolve(process.cwd(), input));
  fs.writeFileSync(
    path.join(dist, 'THIRD_PARTY_LICENSES.txt'),
    thirdPartyLicences(staging, inputs.map((input) => path.relative(staging, input))),
  );
  fs.rmSync(compiled, { recursive: true, force: true });
  const removed = pruneToClosure(nodeModules, keep);
  log(
    `Bundled the backend into dist/main.js (${inputs.length} modules), copied ${assets} assets, ` +
      `kept ${keep.size} external packages, removed ${removed}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stagingDir = process.argv[2];
  if (!stagingDir || !fs.existsSync(path.join(stagingDir, 'dist', 'main.js'))) {
    console.error('usage: node bundle-backend.mjs <staging dir with dist/main.js and node_modules>');
    process.exit(2);
  }
  // esbuild is a backend devDependency: resolve it from the backend package.
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
  const esbuild = createRequire(path.join(backendDir, 'package.json'))('esbuild');
  bundleStagedBackend(stagingDir, { esbuild }).catch((error) => {
    console.error(`[bundle-backend] ${error.message}`);
    process.exit(1);
  });
}
