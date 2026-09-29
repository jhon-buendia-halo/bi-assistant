#!/usr/bin/env node
// Copies the Angular web build (frontend/dist/frontend/browser) into
// backend/public so the npm package can serve it (see src/app-bootstrap.ts).
const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser');
const target = path.resolve(__dirname, '..', 'public');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error(`copy-web: no index.html in ${source} — build the frontend first (npm --prefix ../frontend run build:web).`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log(`copy-web: copied ${source} -> ${target}`);
