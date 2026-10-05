import { createHash } from 'crypto';

/**
 * The engine's levers, as one options object.
 *
 * The improvement loop (`docs/plans/improvement-loop-engineering.md`) changes
 * one thing about how the assistant answers, re-runs the suites and keeps the
 * change only if pass^3 went up. That only works if every lever can be
 * switched per run without a code change, so each one is a field here:
 *
 * - **Production defaults** are persisted (`EngineSettingsDoc`, Settings →
 *   Engine levers) and apply to every chat turn.
 * - **An eval run overrides them per arm** (`ARM_PRESETS`), so `baseline` vs
 *   `fixer-off` is two runs of the same suite, not two builds.
 *
 * `ENGINE_DEFAULTS` is today's engine, exactly: a lever that is implemented
 * but not yet measured ships switched off, so the Iteration 0 baseline
 * measures the engine as it was and every later claim has a real "before".
 * The one exception is `repairIntentGuard` — it belongs to WS0 (making the
 * scorecard honest), not to a lever.
 *
 * Pure module: no Nest, no I/O, no model calls. The CLI (ts-node), the Nest
 * app, the Mastra tools and the unit tests all import it.
 */

/** Careful mode: never, always, or only for risky questions (L4 Stage C). */
export type CarefulMode = 'off' | 'on' | 'auto';

/** `bare` = schema only, what a new customer gets on day one (L2 two arms). */
export type ContextMode = 'curated' | 'bare';

export type EngineReasoningEffort = 'low' | 'medium' | 'high';

/**
 * Learning memory (ADR-0013, `modules/memory`): `off` neither recalls nor
 * retains; `recall` puts what past sessions taught into the turn and retains
 * new user signals; `recall+models` also adds the bank's mental models.
 */
export type MemoryMode = 'off' | 'recall' | 'recall+models';

export interface EngineOptions {
  /** L4: independent re-derivation of the answer's SQL. */
  careful: CarefulMode;
  /** L4 Stage C0: one review call over the transcript, one corrective pass on a finding. */
  answerReview: boolean;
  /** L3: the `sql-fixer` repair loop. Off = the assistant (which knows the question) retries. */
  sqlRepair: boolean;
  /** WS0 0.11: deterministic diff of original vs repaired SQL; warns when a repair changed the question. */
  repairIntentGuard: boolean;
  /** L2: `bare` drops the Knowledge, Metrics and verified-query blocks. */
  context: ContextMode;
  /** L2: per-entity schema cards and column profiles in `describe_entity`. */
  columnProfiles: boolean;
  /** L2: a Knowledge snippet about a column rendered beside that column. */
  inlineKnowledge: boolean;
  /** L2: Knowledge and Metrics ranked by relevance to the question instead of newest-first. */
  rankedKnowledge: boolean;
  /** L2: `lookup_values` and `lookup_knowledge` tools available to the assistant. */
  lookupTools: boolean;
  /** L3: parse-validate-enrich before execution (zero tokens, warnings only). */
  sqlPrecheck: boolean;
  /** L3: errors name the closest columns/tables, types and known values. */
  descriptiveErrors: boolean;
  /** L3: constant metric of any value, id-only projection, missing default filter. */
  extendedGuards: boolean;
  /** L3: static context blocks first, dynamic (visuals, verified pairs) last, for caching. */
  staticFirstContext: boolean;
  /**
   * L5: assistant rule-group ids removed from the prompt
   * (`assistant-instructions.ts`). `'*'` removes every ablatable group.
   */
  promptAblation: string[];
  /** L1: overrides Settings → LLM reasoning effort for this run. */
  reasoningEffort?: EngineReasoningEffort;
  /** Overrides `ASSISTANT_MAX_STEPS`. */
  maxSteps?: number;
  /**
   * Hindsight memory (ADR-0013): recall from approvals and corrections made
   * in other sessions, retain new ones. Inert without `HINDSIGHT_URL`.
   */
  memory: MemoryMode;
}

/** Today's engine. See the module comment for why every lever starts off. */
export const ENGINE_DEFAULTS: Readonly<EngineOptions> = Object.freeze({
  careful: 'off',
  answerReview: false,
  sqlRepair: true,
  repairIntentGuard: true,
  context: 'curated',
  columnProfiles: false,
  inlineKnowledge: false,
  rankedKnowledge: false,
  lookupTools: false,
  sqlPrecheck: false,
  descriptiveErrors: false,
  extendedGuards: false,
  staticFirstContext: false,
  promptAblation: [],
  memory: 'off',
});

/** requestContext key the tools read the turn's resolved options from. */
export const ENGINE_OPTIONS_CONTEXT_KEY = 'engine-options';

/** Tools that exist only when `lookupTools` is on. */
export const LOOKUP_TOOL_NAMES = ['lookup_values', 'lookup_knowledge'] as const;

/**
 * Eval categories where `careful: 'auto'` runs the cross-check. These are the
 * failure classes whose wrong answers look confident: a ratio of the wrong
 * columns, a metric computed without its definition, a join that fans out.
 */
export const RISKY_CATEGORIES: ReadonlySet<string> = new Set([
  'ratio-trap',
  'metric-definition',
  'multi-step-join',
  'default-filter',
  'unit-confusion',
]);

const CONTEXT_LEVERS: Partial<EngineOptions> = {
  columnProfiles: true,
  inlineKnowledge: true,
  rankedKnowledge: true,
  lookupTools: true,
};

const TOOL_LEVERS: Partial<EngineOptions> = {
  descriptiveErrors: true,
  sqlPrecheck: true,
  extendedGuards: true,
  staticFirstContext: true,
};

/**
 * Named arms for eval runs. Each is applied over the production defaults, so
 * `baseline` means "what chat does today, as configured" and `legacy` means
 * "the engine as shipped, whatever Settings says".
 */
export const ARM_PRESETS: Readonly<Record<string, Partial<EngineOptions>>> =
  Object.freeze({
    baseline: {},
    legacy: { ...ENGINE_DEFAULTS, promptAblation: [] },
    bare: { context: 'bare' },
    curated: { context: 'curated' },
    profiles: { columnProfiles: true, inlineKnowledge: true },
    ranked: { rankedKnowledge: true },
    lookup: { lookupTools: true },
    'context-full': { ...CONTEXT_LEVERS },
    errors: { descriptiveErrors: true },
    // The split-brain test (§9.7): the fixer never sees the question, so turn
    // it off and let the assistant retry — with errors that say how to fix it.
    'fixer-off': { sqlRepair: false, descriptiveErrors: true },
    precheck: { sqlPrecheck: true },
    guards: { extendedGuards: true },
    'static-first': { staticFirstContext: true },
    'tools-full': { ...TOOL_LEVERS },
    review: { answerReview: true },
    'careful-auto': { careful: 'auto' },
    'careful-on': { careful: 'on' },
    'no-prompt-rules': { promptAblation: ['*'] },
    'effort-medium': { reasoningEffort: 'medium' },
    'effort-low': { reasoningEffort: 'low' },
    'memory-recall': { memory: 'recall' },
    'memory-models': { memory: 'recall+models' },
    full: {
      ...CONTEXT_LEVERS,
      ...TOOL_LEVERS,
      answerReview: true,
      careful: 'auto',
    },
  });

/** One line per arm, for the arm picker and the run report. */
export const ARM_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze(
  {
    baseline: 'Production defaults as saved in Settings → Engine levers',
    legacy: 'The engine as shipped, ignoring Settings (every lever off)',
    bare: 'Schema only — no Knowledge, Metrics or verified queries',
    curated: 'Knowledge, Metrics and verified queries in context',
    profiles: 'Column profiles and Knowledge beside each column',
    ranked: 'Knowledge and Metrics ranked by relevance to the question',
    lookup: 'lookup_values and lookup_knowledge tools',
    'context-full': 'Every context lever (profiles, inline, ranked, lookup)',
    errors: 'Descriptive tool errors (closest names, types, values)',
    'fixer-off': 'SQL fixer off, descriptive errors on — the assistant retries',
    precheck: 'Static SQL check before execution',
    guards: 'Extended result guards',
    'static-first': 'Static context first, dynamic last',
    'tools-full': 'Every tool lever (errors, precheck, guards, static-first)',
    review: 'Answer review before the answer is shown',
    'careful-auto': 'Careful mode on risky questions and guard-fired turns',
    'careful-on': 'Careful mode on every turn',
    'no-prompt-rules': 'Prompt ablation — every ablatable rule group removed',
    'effort-medium': 'Reasoning effort medium',
    'effort-low': 'Reasoning effort low',
    'memory-recall': 'Hindsight memory recalled into the turn',
    'memory-models': 'Hindsight memory recalled, plus the mental models',
    full: 'Every lever on (context, tools, review, careful auto)',
  },
);

type OptionKind =
  'boolean' | 'careful' | 'context' | 'effort' | 'steps' | 'list' | 'memory';

const OPTION_KINDS: Readonly<Record<keyof EngineOptions, OptionKind>> = {
  careful: 'careful',
  answerReview: 'boolean',
  sqlRepair: 'boolean',
  repairIntentGuard: 'boolean',
  context: 'context',
  columnProfiles: 'boolean',
  inlineKnowledge: 'boolean',
  rankedKnowledge: 'boolean',
  lookupTools: 'boolean',
  sqlPrecheck: 'boolean',
  descriptiveErrors: 'boolean',
  extendedGuards: 'boolean',
  staticFirstContext: 'boolean',
  promptAblation: 'list',
  reasoningEffort: 'effort',
  maxSteps: 'steps',
  memory: 'memory',
};

/** Every option key, in declaration order. */
export const ENGINE_OPTION_KEYS = Object.keys(
  OPTION_KINDS,
) as (keyof EngineOptions)[];

function isOptionKey(key: string): key is keyof EngineOptions {
  return (ENGINE_OPTION_KEYS as string[]).includes(key);
}

/** One value checked against its option's kind; `undefined` when invalid. */
function coerce(kind: OptionKind, value: unknown): unknown {
  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'careful':
      return value === 'off' || value === 'on' || value === 'auto'
        ? value
        : undefined;
    case 'context':
      return value === 'curated' || value === 'bare' ? value : undefined;
    case 'effort':
      return value === 'low' || value === 'medium' || value === 'high'
        ? value
        : undefined;
    case 'steps':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 50
        ? value
        : undefined;
    case 'memory':
      return value === 'off' || value === 'recall' || value === 'recall+models'
        ? value
        : undefined;
    case 'list':
      return Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string' && entry.trim())
        ? [...new Set(value.map((entry: string) => entry.trim()))]
        : undefined;
  }
}

/**
 * Keep only known keys with valid values. Settings documents and API bodies
 * are untrusted JSON: an unknown or mistyped lever is dropped, never allowed
 * to reach a turn as a truthy string.
 */
export function sanitizeEngineOptions(value: unknown): Partial<EngineOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean: Partial<Record<keyof EngineOptions, unknown>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isOptionKey(key)) continue;
    const coerced = coerce(OPTION_KINDS[key], raw);
    if (coerced !== undefined) clean[key] = coerced;
  }
  return clean as Partial<EngineOptions>;
}

/**
 * Production defaults, then each override in order (an arm preset, then a
 * run's explicit overrides). Later wins; invalid fields are ignored.
 */
export function resolveEngineOptions(
  defaults?: Partial<EngineOptions>,
  ...overrides: (Partial<EngineOptions> | undefined)[]
): EngineOptions {
  const resolved: EngineOptions = {
    ...ENGINE_DEFAULTS,
    promptAblation: [...ENGINE_DEFAULTS.promptAblation],
  };
  for (const layer of [defaults, ...overrides]) {
    Object.assign(resolved, sanitizeEngineOptions(layer));
  }
  return resolved;
}

/** The options an arm name selects: a preset, or `custom:{json}`. */
export function armOptions(arm: string | undefined): Partial<EngineOptions> {
  const name = (arm ?? '').trim();
  if (!name) return {};
  if (name.startsWith('custom:')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(name.slice('custom:'.length));
    } catch {
      throw new Error(`Arm "${name}" is not valid JSON after "custom:"`);
    }
    return sanitizeEngineOptions(parsed);
  }
  const preset = ARM_PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown arm "${name}" — known arms: ${Object.keys(ARM_PRESETS).join(', ')}`,
    );
  }
  return { ...preset };
}

const TRUE_WORDS = new Set(['true', 'on', 'yes', '1']);
const FALSE_WORDS = new Set(['false', 'off', 'no', '0']);

/**
 * The CLI form: `sqlRepair=false,careful=auto,promptAblation=visuals+ratio`
 * (`memory=recall+models` keeps its `+`: only a `list` option splits on it).
 * Throws on an unknown key or a value its option cannot take — a typo in a
 * paid run's flags must fail before the first token, not silently run the
 * wrong arm.
 */
export function parseEngineOverride(text: string): Partial<EngineOptions> {
  const parsed: Partial<Record<keyof EngineOptions, unknown>> = {};
  for (const part of (text ?? '').split(',')) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new Error(`Engine override "${pair}" is not key=value`);
    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    if (!isOptionKey(key)) {
      throw new Error(
        `Unknown engine option "${key}" — known: ${ENGINE_OPTION_KEYS.join(', ')}`,
      );
    }
    const kind = OPTION_KINDS[key];
    let value: unknown = raw;
    if (kind === 'boolean') {
      const lower = raw.toLowerCase();
      value = TRUE_WORDS.has(lower)
        ? true
        : FALSE_WORDS.has(lower)
          ? false
          : undefined;
    } else if (kind === 'steps') {
      value = Number(raw);
    } else if (kind === 'list') {
      value = raw ? raw.split('+').map((entry) => entry.trim()) : [];
    }
    const coerced = coerce(kind, value);
    if (coerced === undefined) {
      throw new Error(`Engine option "${key}" cannot be "${raw}"`);
    }
    parsed[key] = coerced;
  }
  return parsed as Partial<EngineOptions>;
}

/** `key=value` for every option that differs from `reference`. */
export function describeEngineDiff(
  options: EngineOptions,
  reference: EngineOptions = ENGINE_DEFAULTS,
): string[] {
  const diff: string[] = [];
  for (const key of ENGINE_OPTION_KEYS) {
    const a = JSON.stringify(options[key] ?? null);
    const b = JSON.stringify(reference[key] ?? null);
    if (a !== b) diff.push(`${key}=${a.replace(/"/g, '')}`);
  }
  return diff;
}

/** Canonical JSON: keys sorted at every level, so equal configs hash equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

/**
 * A short, stable id for "the same engine": two runs with the same hash ran
 * the same levers (plus whatever `extra` pins — model, effort, judge), so
 * their numbers are comparable. 12 hex chars of SHA-1.
 *
 * `memory: 'off'` is left out of the payload: it is the engine as it was
 * before the lever existed, so every earlier run keeps its hash and stays
 * comparable. Any other memory mode is hashed like every other lever.
 */
export function engineConfigHash(
  options: EngineOptions,
  extra?: Record<string, unknown>,
): string {
  const engine: Partial<EngineOptions> = { ...options };
  if (engine.memory === 'off') delete engine.memory;
  const payload = JSON.stringify(canonical({ engine, ...extra }));
  return createHash('sha1').update(payload).digest('hex').slice(0, 12);
}

/**
 * The options a turn was started with, read back off its requestContext by a
 * tool. Falls back to today's engine when nothing was set — a tool invoked
 * outside a turn (a unit test, Mastra Studio) behaves as it always did.
 */
export function readEngineOptions(
  requestContext: { get(key: string): unknown } | undefined,
): EngineOptions {
  const stored = requestContext?.get(ENGINE_OPTIONS_CONTEXT_KEY);
  return resolveEngineOptions(
    stored && typeof stored === 'object' ? stored : {},
  );
}

/** Persisted production defaults (settings store, key `'engine'`). */
export interface EngineSettingsDoc {
  key: 'engine';
  /** Only the levers the operator changed; missing ones fall back to `ENGINE_DEFAULTS`. */
  defaults: Partial<EngineOptions>;
  /**
   * Router id the eval judge runs on (e.g. `openai/gpt-4.1-mini`), pinned so
   * changing the assistant's model does not move the ruler. Absent = the
   * assistant's configured model.
   */
  judgeModel?: string;
  /** Send `reasoningEffort` to Databricks serving endpoints (off: many reject it). */
  databricksReasoningEffort?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
