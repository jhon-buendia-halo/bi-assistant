/**
 * The engine's levers, mirrored from the backend's
 * `backend/src/modules/engine/engine-options.ts` (the improvement loop —
 * `docs/plans/improvement-loop-engineering.md`). This is a pure, one-way
 * mirror: the backend is the source of truth for defaults, arm presets and
 * their descriptions — those travel over the wire via `EngineSettingsView`
 * rather than being duplicated here, to avoid the two copies drifting apart.
 * Only the *shapes* (`EngineOptions` and friends) and small pure formatting
 * helpers live on this side.
 */

/** Careful mode: never, always, or only for risky questions (L4 Stage C). */
export type CarefulMode = 'off' | 'on' | 'auto';

/** `bare` = schema only, what a new customer gets on day one (L2 two arms). */
export type ContextMode = 'curated' | 'bare';

/** Hindsight cross-session memory: off, recall into context, or recall plus mental models. */
export type MemoryMode = 'off' | 'recall' | 'recall+models';

export type EngineReasoningEffort = 'low' | 'medium' | 'high';

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
  /** Hindsight memory spike: learn from approvals and corrections across sessions. */
  memory: MemoryMode;
  /** L1: overrides Settings → LLM reasoning effort for this run. */
  reasoningEffort?: EngineReasoningEffort;
  /** Overrides `ASSISTANT_MAX_STEPS`. */
  maxSteps?: number;
}

/** One rule group the prompt-ablation lever can remove (see `promptAblation`). */
export interface EngineRuleGroup {
  id: string;
  title: string;
  /** Non-ablatable groups (`role`, `procedure`, `grounding`) are shown but not selectable. */
  ablatable: boolean;
}

/**
 * `GET /engine/settings` — everything the Settings → Engine levers screen and
 * the eval arm picker need in one call.
 */
export interface EngineSettingsView {
  /** Production defaults, resolved: `ENGINE_DEFAULTS` overlaid with `stored`. */
  defaults: EngineOptions;
  /** Only the levers the operator changed from `ENGINE_DEFAULTS`. */
  stored: Partial<EngineOptions>;
  /** Today's engine, exactly — the reference `engineDiff` compares against. */
  productionDefaults: EngineOptions;
  /** Router id the eval judge runs on, e.g. `openai/gpt-4.1-mini`. `null` = the agent's own model. */
  judgeModel: string | null;
  /** Send `reasoningEffort` to Databricks serving endpoints (off: many reject it). */
  databricksReasoningEffort: boolean;
  /** Named arms for eval runs — preset name to the overrides it applies. */
  arms: Record<string, Partial<EngineOptions>>;
  /** One line per arm, for the arm picker and the run report. */
  armDescriptions: Record<string, string>;
  /** Prompt rule groups, for the ablation checklist. */
  ruleGroups: EngineRuleGroup[];
}

/** `PUT /engine/settings` body. */
export interface EngineSettingsSaveRequest {
  defaults?: Partial<EngineOptions>;
  judgeModel?: string | null;
  databricksReasoningEffort?: boolean;
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

type EngineOptionKind =
  'boolean' | 'careful' | 'context' | 'memory' | 'effort' | 'steps' | 'list';

const ENGINE_OPTION_KINDS: Readonly<
  Record<keyof EngineOptions, EngineOptionKind>
> = {
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
  memory: 'memory',
  reasoningEffort: 'effort',
  maxSteps: 'steps',
};

/** Every option key, in declaration order — same order `engineDiff` reports in. */
export const ENGINE_OPTION_KEYS = Object.keys(
  ENGINE_OPTION_KINDS,
) as (keyof EngineOptions)[];

function isEngineOptionKey(key: string): key is keyof EngineOptions {
  return Object.prototype.hasOwnProperty.call(ENGINE_OPTION_KINDS, key);
}

/** One value checked against its option's kind; `undefined` when invalid. */
function coerceEngineOption(kind: EngineOptionKind, value: unknown): unknown {
  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'careful':
      return value === 'off' || value === 'on' || value === 'auto'
        ? value
        : undefined;
    case 'context':
      return value === 'curated' || value === 'bare' ? value : undefined;
    case 'memory':
      return value === 'off' || value === 'recall' || value === 'recall+models'
        ? value
        : undefined;
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
    case 'list':
      return Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string' && entry.trim())
        ? [...new Set(value.map((entry: string) => entry.trim()))]
        : undefined;
  }
}

/**
 * `key=value` for every option in `options` that differs from `reference`
 * (usually `EngineSettingsView.productionDefaults`). Mirrors the backend's
 * `describeEngineDiff` so an arm's effect reads the same in the CLI report
 * and the run summary card.
 */
export function engineDiff(
  options: EngineOptions,
  reference: EngineOptions,
): string[] {
  const diff: string[] = [];
  for (const key of ENGINE_OPTION_KEYS) {
    const a = JSON.stringify(options[key] ?? null);
    const b = JSON.stringify(reference[key] ?? null);
    if (a !== b) diff.push(`${key}=${a.replace(/"/g, '')}`);
  }
  return diff;
}

const ENGINE_TRUE_WORDS = new Set(['true', 'on', 'yes', '1']);
const ENGINE_FALSE_WORDS = new Set(['false', 'off', 'no', '0']);

export interface EngineOverrideParseResult {
  overrides: Partial<EngineOptions>;
  /** One message per pair that could not be parsed; empty when `overrides` is complete. */
  errors: string[];
}

/**
 * Client-side mirror of the backend's `parseEngineOverride`
 * (`sqlRepair=false,careful=auto,promptAblation=visuals+ratio`), for the
 * custom-arm textarea. Unlike the backend's CLI-facing version, this never
 * throws: a bad pair is collected into `errors` and the rest of the text is
 * still parsed, so a typo in one field does not blank the whole form.
 */
export function parseEngineOverrideText(
  text: string,
): EngineOverrideParseResult {
  const overrides: Partial<Record<keyof EngineOptions, unknown>> = {};
  const errors: string[] = [];

  for (const part of (text ?? '').split(',')) {
    const pair = part.trim();
    if (!pair) continue;

    const eq = pair.indexOf('=');
    if (eq <= 0) {
      errors.push(`"${pair}" is not key=value`);
      continue;
    }

    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    if (!isEngineOptionKey(key)) {
      errors.push(`Unknown engine option "${key}"`);
      continue;
    }

    const kind = ENGINE_OPTION_KINDS[key];
    let value: unknown = raw;
    if (kind === 'boolean') {
      const lower = raw.toLowerCase();
      value = ENGINE_TRUE_WORDS.has(lower)
        ? true
        : ENGINE_FALSE_WORDS.has(lower)
          ? false
          : undefined;
    } else if (kind === 'steps') {
      value = Number(raw);
    } else if (kind === 'list') {
      value = raw ? raw.split('+').map((entry) => entry.trim()) : [];
    }

    const coerced = coerceEngineOption(kind, value);
    if (coerced === undefined) {
      errors.push(`Engine option "${key}" cannot be "${raw}"`);
      continue;
    }
    overrides[key] = coerced;
  }

  return { overrides: overrides as Partial<EngineOptions>, errors };
}
