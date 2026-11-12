// Pure logic for scripts/roadmap-archive.mjs (roadmap 1.23.30, delivery.md 13):
// move finished milestones from roadmap.md to roadmap-archive.md, verbatim.

export const ARCHIVE_FILE = 'roadmap-archive.md';
export const BACKLOG_FILE = 'roadmap-backlog.md';
export const ARCHIVED_MARK = ` — archived, see ${ARCHIVE_FILE}`;
export const ARCHIVE_HEADER = [
  '# Roadmap archive',
  '',
  'Milestones whose features are all `✅ Done` or `🚫 Cut`, moved verbatim and in order from [roadmap.md](roadmap.md) by `node scripts/roadmap-archive.mjs` (roadmap 1.23.30). Each keeps a one-line skeleton heading in `roadmap.md`. Never edit a moved entry here except to correct a typo; Open stories live in [roadmap-backlog.md](roadmap-backlog.md). `qa.mjs`, `demo-page.mjs`, `story-pack.mjs`, `spec-index.mjs` and `check-specs.py` read all three files.',
  '',
  '',
].join('\n');

const MILESTONE = /^### Milestone ([\d.]+) — /;
const MOVED_LINE = /^- [\d.]+ .* — moved to Backlog \(/;
const SECTION_END = /^##? /; // `## Release …`, `## Backlog`

/**
 * Milestone sections of a roadmap: [{ start, end, heading, number }] with
 * 0-based line indexes, `end` exclusive. A section runs to the next `### ` or
 * `## ` heading.
 */
export function milestoneSections(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const m = MILESTONE.exec(line);
    if (m) out.push({ start: i, end: lines.length, heading: line, number: m[1] });
  });
  for (const s of out) {
    for (let i = s.start + 1; i < lines.length; i++) {
      if (/^### /.test(lines[i]) || SECTION_END.test(lines[i])) {
        s.end = i;
        break;
      }
    }
  }
  return out;
}

/** The statuses of the `####` features of a section. */
export function featureStatuses(sectionLines) {
  return sectionLines
    .filter((l) => /^#### /.test(l))
    .map((l) => {
      const m = /`(✅ Done|🚫 Cut|📋 Planned|🚧 In progress|[^`]*)`\s*$/u.exec(l);
      return m ? m[1] : null;
    });
}

/** Archivable: every feature Done or Cut (or none left but backlog placeholders), not already archived, not Milestone 1.23. */
export function isArchivable(section, sectionLines) {
  if (section.number === '1.23' || section.heading.includes('(M1-23)')) return false;
  if (section.heading.includes(ARCHIVED_MARK)) return false;
  const statuses = featureStatuses(sectionLines);
  // A milestone whose open features all moved to the backlog keeps only placeholder lines.
  if (statuses.length === 0) return sectionLines.some((l) => MOVED_LINE.test(l));
  return statuses.every((s) => s === '✅ Done' || s === '🚫 Cut');
}

/** The skeleton heading kept in roadmap.md: the milestone heading (it names its epic) plus the archive mark. */
export function skeletonHeading(heading) {
  return `${heading.trimEnd()}${ARCHIVED_MARK}`;
}

/**
 * { roadmap, archive, moved: [milestone numbers] }. `archive` is the existing
 * archive text (or '') with the newly moved sections appended in order.
 */
export function archiveRoadmap(roadmapText, archiveText = '') {
  const eol = roadmapText.includes('\r\n') ? '\r\n' : '\n';
  const lines = roadmapText.split(/\r?\n/);
  const sections = milestoneSections(lines);
  const moved = [];
  const out = [];
  const archived = [];
  let cursor = 0;
  for (const s of sections) {
    const body = lines.slice(s.start, s.end);
    if (!isArchivable(s, body)) continue;
    out.push(...lines.slice(cursor, s.start));
    out.push(skeletonHeading(s.heading), '');
    cursor = s.end;
    archived.push(...body);
    moved.push(s.number);
  }
  out.push(...lines.slice(cursor));
  const base = archiveText || ARCHIVE_HEADER;
  const archive = moved.length ? `${base.replace(/\s+$/, '')}\n\n${archived.join('\n').replace(/\s+$/, '')}\n` : base;
  return { roadmap: out.join(eol), archive, moved };
}

/** Every `#### <id> — ` heading line of one or more roadmap texts, so a reader can find an archived story. */
export function joinRoadmaps(...texts) {
  return texts.filter((t) => typeof t === 'string').join('\n');
}
