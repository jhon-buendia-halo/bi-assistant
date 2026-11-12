// Deletes build-time leftovers from the staged backend's production
// node_modules before packaging (delivery.md section 2, roadmap 1.7.22).
//   node frontend/scripts/prune-node-modules.mjs <node_modules dir>
//
// The Windows installer's time is dominated by its file count (NTFS and
// Defender pay per file), and over half the files in node_modules are never
// loaded at runtime: type declarations, source maps, TypeScript sources,
// docs and lint/CI configs. Licence files are kept. `@github/copilot-sdk*` is
// left whole: its bundled runtime reads its own .md and .ts files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source maps only by their `<code>.map` form: a bare `.map` can be data.
const PRUNED_EXTENSIONS =
  /\.([cm]?ts|[cm]?jsx?|tsx|css)\.map$|\.(d\.[cm]?ts|[cm]?ts|md|mdx|markdown)$/i;
const PRUNED_FILE_NAMES = new Set([
  '.editorconfig',
  '.gitattributes',
  '.npmignore',
  '.travis.yml',
  '.jshintrc',
  '.babelrc',
]);
const PRUNED_FILE_PREFIXES = ['.eslintrc', '.nycrc', '.prettierrc'];
const PRUNED_DIRS = new Set(['__tests__', '.github']);
const KEPT_PREFIX = /^(licen[cs]e|notice|copying)/i;
const UNTOUCHED_PACKAGE = /^@github\/copilot-sdk/;

/** True when a file name is a build-time leftover that may be deleted. */
export function isPrunableFile(name) {
  if (KEPT_PREFIX.test(name)) return false;
  if (PRUNED_FILE_NAMES.has(name)) return true;
  if (PRUNED_FILE_PREFIXES.some((p) => name.startsWith(p))) return true;
  return PRUNED_EXTENSIONS.test(name);
}

/** True for a directory that holds no runtime code. */
export function isPrunableDir(name) {
  return PRUNED_DIRS.has(name);
}

/** True for a package (`name` or `@scope/name`) that must not be touched. */
export function isUntouchedPackage(packageName) {
  return UNTOUCHED_PACKAGE.test(packageName);
}

/**
 * Walks a node_modules tree (nested ones included) and deletes what the
 * rules above allow. Returns `{ files, dirs }` counts of what was removed.
 */
export function pruneNodeModules(root) {
  const removed = { files: 0, dirs: 0 };
  const walk = (dir, packageName) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.basename(dir) === 'node_modules') {
          if (entry.name.startsWith('@')) {
            for (const scoped of fs.readdirSync(full, { withFileTypes: true })) {
              if (!scoped.isDirectory()) continue;
              const name = `${entry.name}/${scoped.name}`;
              if (!isUntouchedPackage(name)) walk(path.join(full, scoped.name), name);
            }
          } else if (!entry.name.startsWith('.')) {
            walk(full, entry.name);
          }
          continue;
        }
        if (packageName && isPrunableDir(entry.name)) {
          fs.rmSync(full, { recursive: true, force: true });
          removed.dirs += 1;
          continue;
        }
        walk(full, packageName);
      } else if (packageName && entry.isFile() && isPrunableFile(entry.name)) {
        fs.rmSync(full, { force: true });
        removed.files += 1;
      }
    }
  };
  walk(root, null);
  return removed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.argv[2];
  if (!root || !fs.existsSync(root)) {
    console.error('usage: node prune-node-modules.mjs <node_modules dir>');
    process.exit(2);
  }
  const { files, dirs } = pruneNodeModules(path.resolve(root));
  console.log(`Pruned ${files} files and ${dirs} directories from ${root}`);
}
