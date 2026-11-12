// Pure assembly of a story pack (roadmap 1.23.29). `read(rel)` returns a
// file's text or null, so tests need no disk.
import {
  BUILDER_RULES,
  PACK_WARN_BYTES,
  applicableLessons,
  capLines,
  codePaths,
  fileSymbols,
  namedSpecSections,
  namedSpecs,
  lessonAreas,
  planReferences,
  planSections,
  specReferences,
  specSections,
  storyEntry,
} from './spec-index-lib.mjs';

/**
 * { text, bytes, warnings } or null when the story is in none of `roadmaps`.
 */
export function buildPack(id, { read, roadmaps, plans = [], specs = [] }) {
  let entry = null;
  let source = null;
  for (const r of roadmaps) {
    const t = read(r);
    const e = t ? storyEntry(t, id) : null;
    if (e) {
      entry = e;
      source = r;
      break;
    }
  }
  if (!entry) return null;

  const warnings = [];
  const parts = [`# Story pack ${id}`, '', `## 1. Roadmap entry (${source}:${entry.start}-${entry.end})`, '', entry.text, ''];

  // 2. Plan / contract sections.
  const refs = planReferences(entry.text);
  parts.push('## 2. Plan and contract sections', '');
  let planBody = [];
  const resolved = new Set();
  const addFrom = (f) => {
    const text = read(f);
    if (!text) {
      warnings.push(`plan file ${f} not found`);
      return;
    }
    const wanted = refs.sections.length ? planSections(text, refs.sections.filter((x) => !resolved.has(x))) : [];
    for (const s of wanted) {
      planBody.push(`### ${f}:${s.start}-${s.end}`, '', s.text, '');
      resolved.add(s.id);
    }
  };
  for (const f of refs.files) addFrom(f);
  // "plan 1.24.6" with no link: look the section up in every plan file.
  if (refs.sections.some((x) => !resolved.has(x))) {
    for (const f of plans) if (!refs.files.includes(f)) addFrom(f);
  }
  if (!planBody.length) planBody = ['(none cited)', ''];
  parts.push(capLines(planBody.join('\n')), '');

  // 3. Spec sections named in the entry or its plan sections.
  parts.push('## 3. Spec sections (read the range, not the file)', '');
  const specSource = [entry.text, ...planBody].join('\n');
  const specLines = [];
  for (const ref of specReferences(specSource)) {
    const text = read(ref.path);
    if (!text) continue;
    const lines = specSections(ref.path, text, ref.anchor);
    specLines.push(...(lines.length ? lines : [`${ref.path}:1-${text.split('\n').length}  (whole file)`]));
  }
  for (const n of namedSpecs(specSource, specs)) {
    const text = read(n.path);
    if (text) specLines.push(...namedSpecSections(n.path, text, n.rules));
  }
  parts.push(...(specLines.length ? [...new Set(specLines)] : ['(none named)']), '');

  // 4. File map.
  parts.push('## 4. File map', '');
  const paths = codePaths(specSource);
  const mapLines = [];
  for (const p of paths) {
    const text = read(p);
    if (text === null) {
      mapLines.push(`- ${p} (new or missing)`);
      continue;
    }
    mapLines.push(`- ${p}`, ...fileSymbols(text).slice(0, 40).map((s) => `  - ${s}`));
  }
  parts.push(...(mapLines.length ? mapLines : ['(no code paths named)']), '');

  // 5. Lessons.
  parts.push('## 5. Lessons that apply', '');
  const lessons = read('lessons.md');
  const picked = lessons ? applicableLessons(lessons, lessonAreas(entry.text, paths)) : [];
  parts.push(...(picked.length ? picked : ['(lessons.md not found)']), '');

  // 6. Rules and report block.
  parts.push(BUILDER_RULES);

  const text = parts.join('\n');
  const bytes = Buffer.byteLength(text);
  if (bytes > PACK_WARN_BYTES) warnings.push(`pack is ${bytes} bytes, above ${PACK_WARN_BYTES}`);
  return { text, bytes, warnings };
}
