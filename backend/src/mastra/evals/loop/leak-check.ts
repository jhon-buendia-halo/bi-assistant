/**
 * `eval:leak-check`: rejects a change to the lever files that quotes a
 * question bank (agents-evals R229, R230). The improvement loop may change
 * the assistant's prompt, tools, context blocks and the domain samples'
 * knowledge seeds, never the questions; a change that copies a question's
 * words, a name, a number or a quoted value from any question bank file (dev
 * and held-out alike, decision D6) or from a planted-facts file would teach
 * the assistant the test instead of the skill.
 *
 * It reads the lines a change adds to the lever files (`git diff` against a
 * base, the staged change, or a patch file), normalises them and the
 * literals alike (`common-words.ts`), and rejects:
 *   1. a question's words: the whole question, 4 or more consecutive words
 *      of it with at least 2 distinctive, or 6 or more of any kind;
 *   2. an entity name, as a whole word, unless common: a capitalised span of
 *      a question that does not start its sentence, an `includes` value, a
 *      run of 4 or more letters of a `matches` or `notMatches` pattern, a
 *      name-like string of a facts file;
 *   3. a number of 3 or more significant digits from a question, a check
 *      argument or a facts file, without separators, as itself or 100 times
 *      itself; years 1900 to 2100 and numbers already in the file at the
 *      base are skipped;
 *   4. a quoted value: a quoted string of a question, an `includes` value,
 *      a string of 4 or more characters of a facts file.
 * A string literal of a reference query only warns. A line moved unchanged
 * within a file, and a literal of the allowlist, are ignored.
 *
 * Rules 2 and 4 skip a value that is common (`CommonVocabulary`): without it
 * an `includes` value such as `matches` would reject every line that uses
 * the word.
 *
 * No Nest, no Mastra, no model.
 */
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { EVAL_SET_FILES } from '../eval-set-files';
import type { EvalSetFileSource, EvalSplit } from '../eval-set-files';
import {
  BACKEND_DIR,
  CONSOLE_IO,
  LoopInputError,
  parseFlags,
  REPO_ROOT,
  resolveUserPath,
  runCommand,
} from './cli-args';
import type { CommandIo } from './cli-args';
import {
  CommonVocabulary,
  containsPhrase,
  normalizeText,
  sampleSchemaNames,
  wordsOf,
} from './common-words';

/**
 * The lever files (R229): folders end with `/`. Unit test files and their
 * fixtures are not lever files.
 */
export const LEVER_PATHS = [
  'backend/src/mastra/agents/',
  'backend/src/mastra/skills/',
  'backend/src/mastra/tools/',
  'backend/src/mastra/context-blocks.ts',
  'backend/src/mastra/tool-section.ts',
  'backend/src/modules/sessions/sessions.service.ts',
  'backend/src/modules/testing-data/fixtures/knowledge/',
] as const;

/** Whether a repository path is a lever file. */
export function isLeverFile(path: string): boolean {
  if (/\.spec\.ts$/.test(path) || path.includes('/__fixtures__/')) {
    return false;
  }
  return LEVER_PATHS.some((lever) =>
    lever.endsWith('/') ? path.startsWith(lever) : path === lever,
  );
}

/** The leak check's allowlist, relative to the repository root. */
export const ALLOWLIST_PATH = 'docs/evals/loop/leak-allowlist.txt';

/** The planted-facts files, `backend/scripts/fixtures/<domain>/facts.json`. */
export const FACTS_DIR = join(BACKEND_DIR, 'scripts', 'fixtures');

// ---------------------------------------------------------------- the diff

export interface AddedLine {
  /** The line's number in the changed file. */
  line: number;
  text: string;
}

export interface FileChange {
  /** The path after the change, relative to the repository root. */
  path: string;
  added: AddedLine[];
  removed: string[];
}

function diffPath(raw: string): string {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return path.replace(/^[ab]\//, '');
}

/**
 * The files of a unified diff (`git diff`, with or without context lines),
 * each with its added lines (and their new line numbers) and removed lines.
 * A hunk ends when its line counts are used up, so a removed line that reads
 * `-- x` is never taken for a file header.
 */
export function parseUnifiedDiff(patch: string): FileChange[] {
  const files: FileChange[] = [];
  let current: FileChange | undefined;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      current = undefined;
      oldLeft = 0;
      newLeft = 0;
      continue;
    }
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('+')) {
        current?.added.push({ line: newLine, text: line.slice(1) });
        newLine += 1;
        newLeft -= 1;
      } else if (line.startsWith('-')) {
        current?.removed.push(line.slice(1));
        oldLeft -= 1;
      } else if (line.startsWith(' ') || line === '') {
        newLine += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/\t.*$/, '');
      current =
        path.trim() === '/dev/null'
          ? undefined
          : { path: diffPath(path), added: [], removed: [] };
      if (current) files.push(current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLine = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return files;
}

// ------------------------------------------------------------- the literals

export type LeakKind =
  'question' | 'entity' | 'number' | 'quoted' | 'sql-literal';

/** The order findings on one line are reported in. */
const KIND_ORDER: readonly LeakKind[] = [
  'question',
  'entity',
  'number',
  'quoted',
  'sql-literal',
];

/** Where a literal comes from: a question bank case, or a facts file. */
export interface LiteralSource {
  /** A set file name (`finance.json`) or a facts file's repository path. */
  file: string;
  /** The case id as the set file writes it; absent for a facts file. */
  caseId?: string;
  split?: EvalSplit;
  /** The case field (`question`, `checks[2].args.text`) or a facts path. */
  field: string;
}

interface Literal {
  /** As written in its source, for the report. */
  display: string;
  sources: LiteralSource[];
}

interface QuestionLiteral {
  words: string[];
  display: string;
  source: LiteralSource;
}

export interface LiteralIndex {
  questions: QuestionLiteral[];
  /** Each question's 4-word runs: `a b c d` → [question, word index]. */
  quadgrams: Map<string, [number, number][]>;
  entities: Map<string, Literal>;
  /** Canonical numbers, and 100 times each, → the literal. */
  numbers: Map<string, Literal>;
  quoted: Map<string, Literal>;
  sqlLiterals: Map<string, Literal>;
}

function addLiteral(
  map: Map<string, Literal>,
  key: string,
  display: string,
  source: LiteralSource,
): void {
  if (!key.trim()) return;
  const entry = map.get(key) ?? { display, sources: [] };
  const same = entry.sources.some(
    (s) =>
      s.file === source.file &&
      s.caseId === source.caseId &&
      s.field === source.field,
  );
  if (!same) entry.sources.push(source);
  map.set(key, entry);
}

/** `88,966` → `88966`, `0.3800` → `0.38`, `007` → `7`. */
export function canonicalNumber(raw: string): string | undefined {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(raw.replace(/[,_\s]/g, ''));
  if (!match || (!match[1] && !match[2])) return undefined;
  const whole = match[1].replace(/^0+/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (!whole && !fraction) return '0';
  return fraction ? `${whole || '0'}.${fraction}` : whole;
}

/** A canonical number times 100: `0.3827` → `38.27`. */
export function times100(canonical: string): string {
  const [whole, fraction = ''] = canonical.split('.');
  const shifted = `${whole}${fraction.slice(0, 2).padEnd(2, '0')}`;
  const rest = fraction.slice(2).replace(/0+$/, '');
  const head = shifted.replace(/^0+/, '') || '0';
  return rest ? `${head}.${rest}` : head;
}

/** Digits without leading and trailing zeros: `0.3827` → 4, `12000` → 2. */
export function significantDigits(canonical: string): number {
  return canonical.replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
    .length;
}

function isYear(canonical: string): boolean {
  if (!/^\d{4}$/.test(canonical)) return false;
  const value = Number(canonical);
  return value >= 1900 && value <= 2100;
}

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** The canonical numbers written in a text. */
export function numbersIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const canonical = canonicalNumber(match[0]);
    if (canonical !== undefined) found.push(canonical);
  }
  return found;
}

/** A separator a pattern puts between the digit groups of one number. */
const PATTERN_SEPARATOR = String.raw`\[[^\]\d]*\][?*]?|\\[.,]|[.,]\??|\\s[?*+]?`;

/**
 * The numbers a regular expression source spells: `\b12[,.\s]?415\b` is
 * 12415 (or 12.415), `\b0\.38` is 0.38.
 */
export function patternNumbers(pattern: string): string[] {
  const found = new Set<string>();
  const number = new RegExp(
    String.raw`\d+(?:(?:${PATTERN_SEPARATOR})\d+)*`,
    'g',
  );
  for (const match of pattern.matchAll(number)) {
    const groups = match[0]
      .split(new RegExp(PATTERN_SEPARATOR))
      .filter(Boolean);
    const joined = canonicalNumber(groups.join(''));
    if (joined) found.add(joined);
    if (groups.length >= 2) {
      const decimal = canonicalNumber(
        `${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`,
      );
      if (decimal) found.add(decimal);
    }
  }
  return [...found];
}

/** The runs of 4 or more letters of a regular expression source. */
export function patternWords(pattern: string): string[] {
  const text = pattern
    .replace(/\[([^\]])[^\]]*\]/g, '$1')
    .replace(/\\[A-Za-z]/g, ' ')
    .replace(/\(\?(?:[:=!]|<[=!])/g, ' ');
  return [...new Set(text.match(/\p{L}{4,}/gu) ?? [])];
}

/**
 * The capitalised spans of a question that do not start a sentence: `Who
 * won the 2022 World Cup?` → `World Cup`.
 */
export function capitalisedSpans(question: string): string[] {
  const spans: string[] = [];
  for (const sentence of question.split(/(?<=[.!?])\s+/)) {
    const words = [...sentence.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)];
    let span: string[] = [];
    const flush = () => {
      if (span.length > 0) spans.push(span.join(' '));
      span = [];
    };
    words.forEach((word, i) => {
      const capitalised = /^\p{Lu}/u.test(word[0]);
      if (capitalised && i > 0) span.push(word[0]);
      else flush();
    });
    flush();
  }
  return spans;
}

/** Quoted strings of a text: `"…"`, and `'…'` that is not an apostrophe. */
export function quotedStrings(text: string): string[] {
  const normalized = normalizeText(text);
  const found: string[] = [];
  for (const match of normalized.matchAll(/"([^"]+)"/g)) found.push(match[1]);
  for (const match of normalized.matchAll(
    /(?:^|[\s([{])'([^']+)'(?=$|[\s.,;:!?)\]}])/g,
  )) {
    found.push(match[1]);
  }
  return found.map((s) => s.trim()).filter(Boolean);
}

/** The string literals of a SQL text, `''` unescaped. */
export function sqlStringLiterals(sql: string): string[] {
  return [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replace(/''/g, "'"),
  );
}

function isNameLike(value: string): boolean {
  return (
    /^\p{Lu}/u.test(value) &&
    !/[.;:!?]/.test(value) &&
    value.length <= 60 &&
    wordsOf(normalizeText(value)).length <= 6
  );
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A facts file read for the literal index. */
export interface FactsFile {
  /** Its path relative to the repository root. */
  file: string;
  content: unknown;
}

/** The literal index of every question bank file and facts file (R229). */
export function buildLiteralIndex(
  setFiles: readonly EvalSetFileSource[],
  factsFiles: readonly FactsFile[],
): LiteralIndex {
  const index: LiteralIndex = {
    questions: [],
    quadgrams: new Map(),
    entities: new Map(),
    numbers: new Map(),
    quoted: new Map(),
    sqlLiterals: new Map(),
  };
  const addNumber = (raw: string, source: LiteralSource) => {
    if (significantDigits(raw) < 3 || isYear(raw)) return;
    addLiteral(index.numbers, raw, raw, source);
    addLiteral(index.numbers, times100(raw), raw, source);
  };
  // A name or a quoted value holds a letter; numbers are rule 3's.
  const addEntity = (display: string, source: LiteralSource) => {
    if (!/\p{L}/u.test(display)) return;
    addLiteral(index.entities, normalizeText(display).trim(), display, source);
  };
  const addQuoted = (display: string, source: LiteralSource) => {
    if (!/\p{L}/u.test(display)) return;
    addLiteral(index.quoted, normalizeText(display).trim(), display, source);
  };

  for (const { file, content } of setFiles) {
    if (!isObject(content) || !Array.isArray(content.cases)) continue;
    for (const raw of content.cases) {
      if (!isObject(raw) || typeof raw.id !== 'string') continue;
      const split: EvalSplit = raw.split === 'held-out' ? 'held-out' : 'dev';
      const at = (field: string): LiteralSource => ({
        file,
        caseId: raw.id as string,
        split,
        field,
      });
      if (typeof raw.question === 'string') {
        const question = raw.question;
        const words = wordsOf(normalizeText(question));
        const q = index.questions.length;
        index.questions.push({
          words,
          display: question,
          source: at('question'),
        });
        for (let i = 0; i + 4 <= words.length; i += 1) {
          const key = words.slice(i, i + 4).join(' ');
          const list = index.quadgrams.get(key) ?? [];
          list.push([q, i]);
          index.quadgrams.set(key, list);
        }
        for (const span of capitalisedSpans(question)) {
          addEntity(span, at('question'));
        }
        for (const n of numbersIn(normalizeText(question))) {
          addNumber(n, at('question'));
        }
        for (const quoted of quotedStrings(question)) {
          addQuoted(quoted, at('question'));
        }
      }
      const checks = Array.isArray(raw.checks) ? raw.checks : [];
      checks.forEach((check, c) => {
        if (!isObject(check) || !isObject(check.args)) return;
        for (const [key, value] of Object.entries(check.args)) {
          const field = `checks[${c}].args.${key}`;
          const texts = Array.isArray(value)
            ? value.filter((v): v is string => typeof v === 'string')
            : typeof value === 'string'
              ? [value]
              : [];
          for (const text of texts) {
            if (key === 'pattern') {
              for (const n of patternNumbers(text)) addNumber(n, at(field));
              if (check.type === 'matches' || check.type === 'notMatches') {
                for (const word of patternWords(text))
                  addEntity(word, at(field));
              }
            } else {
              for (const n of numbersIn(normalizeText(text))) {
                addNumber(n, at(field));
              }
            }
            if (check.type === 'includes' && key === 'text') {
              addEntity(text, at(field));
              addQuoted(text, at(field));
            }
          }
        }
      });
      if (isObject(raw.expectedSql)) {
        for (const [dialect, sql] of Object.entries(raw.expectedSql)) {
          if (typeof sql !== 'string') continue;
          for (const literal of sqlStringLiterals(sql)) {
            if (literal.length < 4) continue;
            addLiteral(
              index.sqlLiterals,
              normalizeText(literal).trim(),
              literal,
              at(`expectedSql.${dialect}`),
            );
          }
        }
      }
    }
  }

  for (const { file, content } of factsFiles) {
    const walk = (value: unknown, path: string) => {
      const source: LiteralSource = { file, field: path || '(root)' };
      if (typeof value === 'number' && Number.isFinite(value)) {
        const canonical = canonicalNumber(
          Math.abs(value).toString().includes('e')
            ? Math.abs(value).toFixed(10)
            : Math.abs(value).toString(),
        );
        if (canonical) addNumber(canonical, source);
      } else if (typeof value === 'string') {
        if (isNameLike(value)) addEntity(value, source);
        if (value.length >= 4) addQuoted(value, source);
        for (const n of numbersIn(normalizeText(value))) addNumber(n, source);
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, `${path}[${i}]`));
      } else if (isObject(value)) {
        for (const [key, item] of Object.entries(value)) {
          walk(item, path ? `${path}.${key}` : key);
        }
      }
    };
    walk(content, '');
  }
  return index;
}

// ------------------------------------------------------------- the check

export interface Finding {
  file: string;
  line: number;
  kind: LeakKind;
  /** The literal as it reads on the added line (normalised). */
  literal: string;
  warning: boolean;
  sources: LiteralSource[];
}

export interface CheckInput {
  changes: readonly FileChange[];
  index: LiteralIndex;
  vocabulary: CommonVocabulary;
  /** Each lever file's text at the base, for the numbers rule. */
  baseText: ReadonlyMap<string, string>;
  /** Normalised allowlisted literals. */
  allowlist: ReadonlySet<string>;
}

export interface CheckResult {
  findings: Finding[];
  leverFiles: string[];
  skippedFiles: string[];
  addedLines: number;
}

function questionFindings(
  words: readonly string[],
  index: LiteralIndex,
  vocabulary: CommonVocabulary,
): { literal: string; sources: LiteralSource[] }[] {
  const found = new Map<string, LiteralSource[]>();
  const record = (literal: string, source: LiteralSource) => {
    const list = found.get(literal) ?? [];
    if (!list.includes(source)) list.push(source);
    found.set(literal, list);
  };
  const seen = new Set<string>();
  for (let i = 0; i + 4 <= words.length; i += 1) {
    const hits = index.quadgrams.get(words.slice(i, i + 4).join(' ')) ?? [];
    for (const [q, at] of hits) {
      const question = index.questions[q].words;
      let start = i;
      let from = at;
      while (start > 0 && from > 0 && words[start - 1] === question[from - 1]) {
        start -= 1;
        from -= 1;
      }
      let end = i + 4;
      let to = at + 4;
      while (
        end < words.length &&
        to < question.length &&
        words[end] === question[to]
      ) {
        end += 1;
        to += 1;
      }
      const key = `${q}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const run = words.slice(start, end);
      const whole = from === 0 && to === question.length;
      const distinctive = run.filter((w) => !vocabulary.isCommonWord(w)).length;
      if (whole || run.length >= 6 || distinctive >= 2) {
        record(run.join(' '), index.questions[q].source);
      }
    }
  }
  // A question of fewer than 4 words can only match whole.
  index.questions.forEach((question) => {
    const n = question.words.length;
    if (n === 0 || n >= 4) return;
    for (let i = 0; i + n <= words.length; i += 1) {
      if (question.words.every((w, k) => words[i + k] === w)) {
        record(question.words.join(' '), question.source);
        break;
      }
    }
  });
  return [...found].map(([literal, sources]) => ({ literal, sources }));
}

/**
 * One leak on a line is reported once: a finding whose literal sits inside a
 * longer one's (`world cup` in `who won the 2022 world cup`) is folded into
 * it, with its sources. A rejection is never folded into a warning.
 */
function mergeContained(onLine: Finding[]): Finding[] {
  const kept: Finding[] = [];
  const byLength = [...onLine].sort(
    (a, b) => b.literal.length - a.literal.length,
  );
  for (const finding of byLength) {
    const into = kept.find(
      (k) =>
        (!k.warning || finding.warning) &&
        containsPhrase(k.literal, finding.literal),
    );
    if (!into) {
      kept.push(finding);
      continue;
    }
    for (const source of finding.sources) {
      if (!into.sources.includes(source)) into.sources.push(source);
    }
  }
  return kept;
}

/** Check every added line of the lever files (R230). */
export function checkChanges(input: CheckInput): CheckResult {
  const { changes, index, vocabulary, baseText, allowlist } = input;
  const findings: Finding[] = [];
  const leverFiles: string[] = [];
  const skippedFiles: string[] = [];
  let addedLines = 0;
  for (const change of changes) {
    if (!isLeverFile(change.path)) {
      if (change.added.length > 0) skippedFiles.push(change.path);
      continue;
    }
    leverFiles.push(change.path);
    const removed = new Map<string, number>();
    for (const line of change.removed) {
      const key = line.trim();
      removed.set(key, (removed.get(key) ?? 0) + 1);
    }
    const baseNumbers = new Set(
      numbersIn(normalizeText(baseText.get(change.path) ?? '')),
    );
    for (const added of change.added) {
      const key = added.text.trim();
      if (!key) continue;
      const moved = removed.get(key) ?? 0;
      if (moved > 0) {
        removed.set(key, moved - 1);
        continue;
      }
      addedLines += 1;
      const text = normalizeText(added.text);
      const words = wordsOf(text);
      const onLine = new Map<string, Finding>();
      const report = (
        kind: LeakKind,
        literal: string,
        sources: LiteralSource[],
      ) => {
        if (allowlist.has(literal.trim())) return;
        const existing = onLine.get(literal);
        if (existing) {
          if (KIND_ORDER.indexOf(kind) < KIND_ORDER.indexOf(existing.kind)) {
            existing.kind = kind;
            existing.warning = kind === 'sql-literal';
          }
          for (const s of sources) {
            if (!existing.sources.includes(s)) existing.sources.push(s);
          }
          return;
        }
        onLine.set(literal, {
          file: change.path,
          line: added.line,
          kind,
          literal,
          warning: kind === 'sql-literal',
          sources: [...sources],
        });
      };
      for (const hit of questionFindings(words, index, vocabulary)) {
        report('question', hit.literal, hit.sources);
      }
      for (const [value, literal] of index.entities) {
        if (containsPhrase(text, value) && !vocabulary.isCommonPhrase(value)) {
          report('entity', value, literal.sources);
        }
      }
      for (const number of numbersIn(text)) {
        if (isYear(number) || baseNumbers.has(number)) continue;
        const literal = index.numbers.get(number);
        if (literal) report('number', number, literal.sources);
      }
      for (const [value, literal] of index.quoted) {
        if (containsPhrase(text, value) && !vocabulary.isCommonPhrase(value)) {
          report('quoted', value, literal.sources);
        }
      }
      for (const [value, literal] of index.sqlLiterals) {
        if (containsPhrase(text, value) && !vocabulary.isCommonPhrase(value)) {
          report('sql-literal', value, literal.sources);
        }
      }
      findings.push(...mergeContained([...onLine.values()]));
    }
  }
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  return { findings, leverFiles, skippedFiles, addedLines };
}

// ------------------------------------------------------------- the report

const HELD_OUT_SOURCE = 'a held-out case';
const FACTS_SOURCE = 'a planted-facts file';

/**
 * A source as the report writes it. With `fixer`, a held-out case (and a
 * facts file, whose values answer held-out questions too) is not named.
 */
export function formatSource(source: LiteralSource, fixer = false): string {
  if (source.caseId === undefined) {
    return fixer ? FACTS_SOURCE : `${source.file} ${source.field}`;
  }
  if (fixer && source.split === 'held-out') return HELD_OUT_SOURCE;
  return `${source.file} case ${source.caseId} (${source.split}) ${source.field}`;
}

function sortedSources(sources: readonly LiteralSource[]): LiteralSource[] {
  const rank = (s: LiteralSource) =>
    s.caseId === undefined ? 2 : s.split === 'held-out' ? 1 : 0;
  return [...sources].sort((a, b) => rank(a) - rank(b));
}

/** `<file>:<line> [<kind>] "<literal>" ← <source>` (R230). */
export function formatFinding(finding: Finding, fixer = false): string {
  const sources = sortedSources(finding.sources);
  const named = sources.map((s) => formatSource(s, fixer));
  const first = named[0] ?? 'unknown';
  const more = [...new Set(named.slice(1))].length;
  const kind = finding.warning ? `${finding.kind}, warning` : finding.kind;
  return `${finding.file}:${finding.line} [${kind}] "${finding.literal}" ← ${first}${
    more > 0 ? ` (and ${more} more)` : ''
  }`;
}

/**
 * The allowlist: one literal per line, then ` | ` and the reason it is
 * allowed; `#` starts a comment line. A line without a reason is refused.
 */
export function parseAllowlist(
  text: string,
  file = ALLOWLIST_PATH,
): Set<string> {
  const allowed = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const bar = line.indexOf(' | ');
    if (bar <= 0 || !line.slice(bar + 3).trim()) {
      throw new LoopInputError(
        `${file}:${i + 1}: write "<literal> | <reason>"`,
      );
    }
    allowed.add(normalizeText(line.slice(0, bar)).trim());
  });
  return allowed;
}

// ------------------------------------------------------------------ git

export type GitRunner = (args: readonly string[], input?: string) => Buffer;

export function gitIn(root: string): GitRunner {
  return (args, input) =>
    execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
      input,
      maxBuffer: 1 << 30,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
}

/** The lever paths as git pathspecs. */
function leverPathspecs(): string[] {
  return LEVER_PATHS.map((p) => (p.endsWith('/') ? p.slice(0, -1) : p));
}

/** Every lever file's text at `base`, by path. */
export function baseLeverTexts(
  git: GitRunner,
  base: string,
): Map<string, string> {
  const paths = git([
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    base,
    '--',
    ...leverPathspecs(),
  ])
    .toString('utf8')
    .split('\0')
    .filter((p) => p && isLeverFile(p));
  const texts = new Map<string, string>();
  if (paths.length === 0) return texts;
  const out = git(
    ['cat-file', '--batch'],
    paths.map((p) => `${base}:${p}`).join('\n') + '\n',
  );
  let at = 0;
  for (const path of paths) {
    const newline = out.indexOf(0x0a, at);
    const header = out.subarray(at, newline).toString('utf8');
    at = newline + 1;
    const size = /^\S+ blob (\d+)$/.exec(header);
    if (!size) continue;
    const length = Number(size[1]);
    texts.set(path, out.subarray(at, at + length).toString('utf8'));
    at += length + 1;
  }
  return texts;
}

/** The change as a diff: against `base`, or the staged change. */
export function gitChange(
  git: GitRunner,
  base: string,
  staged: boolean,
): string {
  return git([
    'diff',
    '-U0',
    '--no-color',
    '--no-ext-diff',
    ...(staged ? ['--cached'] : []),
    base,
    '--',
    ...leverPathspecs(),
  ]).toString('utf8');
}

/** Untracked lever files, each as a change that adds every line. */
export function untrackedLeverChanges(
  git: GitRunner,
  root: string,
): FileChange[] {
  return git([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    ...leverPathspecs(),
  ])
    .toString('utf8')
    .split('\0')
    .filter((p) => p && isLeverFile(p))
    .map((path) => ({
      path,
      added: readFileSync(join(root, path), 'utf8')
        .split('\n')
        .map((text, i) => ({ line: i + 1, text })),
      removed: [],
    }));
}

/** Every `facts.json` under `backend/scripts/fixtures/`. */
export function readFactsFiles(
  factsDir: string = FACTS_DIR,
  root: string = REPO_ROOT,
): FactsFile[] {
  if (!existsSync(factsDir)) return [];
  return readdirSync(factsDir)
    .map((domain) => join(factsDir, domain, 'facts.json'))
    .filter((path) => existsSync(path))
    .map((path) => ({
      file: relative(root, path),
      content: JSON.parse(readFileSync(path, 'utf8')) as unknown,
    }));
}

export const LEAK_CHECK_USAGE =
  'npm --prefix backend run eval:leak-check -- [--base <ref>] [--staged] [--diff-file <path>] [--fixer] [--json]';

const FLAGS = {
  base: 'string',
  staged: 'boolean',
  'diff-file': 'string',
  fixer: 'boolean',
  json: 'boolean',
} as const;

/** The command: exit 1 on any rejection, 0 otherwise, 2 on a bad input. */
export function leakCheckMain(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: CommandIo = CONSOLE_IO,
  root: string = REPO_ROOT,
): Promise<number> {
  return runCommand(io, () => {
    const flags = parseFlags(argv, FLAGS, LEAK_CHECK_USAGE);
    if (flags.staged && flags['diff-file']) {
      throw new LoopInputError('Give --staged or --diff-file, not both');
    }
    const base = flags.base ?? 'HEAD';
    const git = gitIn(root);
    try {
      git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    } catch {
      throw new LoopInputError(`Unknown --base "${base}"`);
    }
    let changes: FileChange[];
    let what: string;
    if (flags['diff-file']) {
      const path = resolveUserPath(flags['diff-file'], env);
      if (!existsSync(path))
        throw new LoopInputError(`No such patch file: ${path}`);
      changes = parseUnifiedDiff(readFileSync(path, 'utf8'));
      what = path;
    } else if (flags.staged) {
      changes = parseUnifiedDiff(gitChange(git, base, true));
      what = `the staged change against ${base}`;
    } else {
      changes = [
        ...parseUnifiedDiff(gitChange(git, base, false)),
        ...untrackedLeverChanges(git, root),
      ];
      what = `the working tree against ${base}`;
    }
    const baseText = baseLeverTexts(git, base);
    const allowlistPath = join(root, ALLOWLIST_PATH);
    const allowlist = existsSync(allowlistPath)
      ? parseAllowlist(readFileSync(allowlistPath, 'utf8'))
      : new Set<string>();
    const result = checkChanges({
      changes,
      index: buildLiteralIndex(EVAL_SET_FILES, readFactsFiles()),
      vocabulary: new CommonVocabulary(
        [...baseText.values()],
        sampleSchemaNames(),
      ),
      baseText,
      allowlist,
    });
    const fixer = flags.fixer === true;
    const rejected = result.findings.filter((f) => !f.warning).length;
    const warnings = result.findings.length - rejected;
    if (flags.json) {
      io.out(
        JSON.stringify(
          {
            change: what,
            base,
            leverFiles: result.leverFiles,
            skippedFiles: result.skippedFiles,
            addedLines: result.addedLines,
            rejected,
            warnings,
            findings: result.findings.map((f) => ({
              file: f.file,
              line: f.line,
              kind: f.kind,
              literal: f.literal,
              warning: f.warning,
              sources: sortedSources(f.sources).map((s) =>
                fixer && (s.split === 'held-out' || s.caseId === undefined)
                  ? { redacted: formatSource(s, true) }
                  : s,
              ),
            })),
          },
          null,
          2,
        ),
      );
    } else {
      for (const finding of result.findings) {
        io.out(formatFinding(finding, fixer));
      }
      if (result.skippedFiles.length > 0) {
        io.out(
          `Not lever files, not checked: ${result.skippedFiles.join(', ')}`,
        );
      }
      io.out(
        `Leak check of ${what}: ${rejected} rejected, ${warnings} warning${warnings === 1 ? '' : 's'}; ` +
          `${result.addedLines} added line${result.addedLines === 1 ? '' : 's'} in ${result.leverFiles.length} lever file${result.leverFiles.length === 1 ? '' : 's'}.`,
      );
    }
    return rejected > 0 ? 1 : 0;
  });
}
