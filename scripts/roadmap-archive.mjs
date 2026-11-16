#!/usr/bin/env node
// node scripts/roadmap-archive.mjs [--dry-run]   (roadmap 1.23.30, delivery.md 13)
// Moves every finished milestone (all features Done or Cut, not Milestone 1.23)
// from roadmap.md to roadmap-archive.md, verbatim, leaving a skeleton heading.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_FILE, archiveRoadmap } from './roadmap-archive-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roadmapPath = path.join(root, 'roadmap.md');
const archivePath = path.join(root, ARCHIVE_FILE);
const result = archiveRoadmap(fs.readFileSync(roadmapPath, 'utf8'), fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '');
console.log(result.moved.length ? `Archive milestones ${result.moved.join(', ')}` : 'Nothing to archive');
if (result.moved.length && !process.argv.includes('--dry-run')) {
  fs.writeFileSync(roadmapPath, result.roadmap);
  fs.writeFileSync(archivePath, result.archive);
  console.log(`roadmap.md ${Buffer.byteLength(result.roadmap)} bytes, ${ARCHIVE_FILE} ${Buffer.byteLength(result.archive)} bytes`);
}
