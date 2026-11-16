#!/usr/bin/env node
// Refuses to publish the npm package unless the web UI bundled into
// backend/public belongs to a brand that may be published (ADR-0045). The web
// build writes public/brand.json = {"id": …} (frontend/scripts/brand.mjs
// ng-build, copied by copy-web.js); the brand's own
// frontend/brands/<id>/brand.json must say "publishNpm": true.
//
// Runs after the build in `prepack` and as its own step in publish-npm.yml
// (which publishes with --ignore-scripts).
// Unit tests: node --test backend/scripts/assert-publishable-brand.test.js
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const DEFAULT_BRANDS_DIR = path.resolve(__dirname, '..', '..', 'frontend', 'brands');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** { ok, message } for the web UI in `publicDir`, judged by the brands in `brandsDir`. */
function checkPublishableBrand({ publicDir = DEFAULT_PUBLIC_DIR, brandsDir = DEFAULT_BRANDS_DIR } = {}) {
  const marker = path.join(publicDir, 'brand.json');
  if (!fs.existsSync(marker)) {
    return { ok: false, message: `${marker} is missing: build the web UI first (npm run build:all).` };
  }
  let id;
  try {
    id = readJson(marker).id;
  } catch (error) {
    return { ok: false, message: `${marker} is not valid JSON: ${error.message}` };
  }
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    return { ok: false, message: `${marker} has no valid brand id (got ${JSON.stringify(id)}).` };
  }
  const brandFile = path.join(brandsDir, id, 'brand.json');
  if (!fs.existsSync(brandFile)) {
    return { ok: false, message: `The web UI is built for brand "${id}", but ${brandFile} does not exist.` };
  }
  let brand;
  try {
    brand = readJson(brandFile);
  } catch (error) {
    return { ok: false, message: `${brandFile} is not valid JSON: ${error.message}` };
  }
  if (brand.publishNpm !== true) {
    return {
      ok: false,
      message: `The web UI is built for brand "${id}", which may not be published to npm (publishNpm is not true). Rebuild with BRAND=halo.`,
    };
  }
  return { ok: true, message: `brand "${id}" may be published` };
}

module.exports = { checkPublishableBrand };

if (require.main === module) {
  const result = checkPublishableBrand();
  if (result.ok) {
    console.log(`assert-publishable-brand: ${result.message}`);
  } else {
    console.error(`assert-publishable-brand: ${result.message}`);
    process.exit(1);
  }
}
