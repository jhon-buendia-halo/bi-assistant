// Which reasoning-effort levels each model accepts. Providers reject a level
// a model doesn't take (gpt-5 has `minimal` but no `none`; gpt-5.1 the other
// way round; most Claude models before Haiku 5 take no effort at all), so the
// settings form offers only these, the connection probe sends the lowest one,
// and every call maps its effort onto them. Checked against the OpenAI model
// pages and Anthropic's Effort page on 2026-10-10; the table lives in
// specs/system/agents.md section 1.4.

/** Every effort any provider takes, lowest first. */
export const EFFORT_SCALE = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof EFFORT_SCALE)[number];

const FALLBACK: ReasoningEffort[] = ['low', 'medium', 'high'];
const CLAUDE_ALL: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Claude models that reject `output_config.effort` with a 400: Haiku before
 * Haiku 5, the Claude 3 line, and the Sonnet 4 / 4.5 and Opus 4 / 4.1
 * generation.
 */
const CLAUDE_REJECTS_EFFORT =
  /claude-(?:haiku-[1-4]|3|sonnet-4-5|sonnet-4-\d{8}|opus-4-1|opus-4-\d{8})/i;

/**
 * `gpt-<major>[.<minor>]`, or `gpt-<major><minor>` as LenAI writes it
 * (`mmc-tech-gpt-52-272k-…`). A dated suffix (`gpt-5-2025-08-07`) has no
 * minor: the minor digit must follow a dot or the major digit directly.
 */
const GPT_VERSION = /gpt-?(\d)(?:\.(\d)|(\d)(?!\d))?/i;
const O_SERIES = /(?:^|[^a-z0-9])o[1-4](?:$|[^a-z0-9])/i;

function gptLevels(name: string): ReasoningEffort[] | null {
  const match = GPT_VERSION.exec(name);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? match[3] ?? 0);
  const pro = /(?:^|[^a-z])pro(?:$|[^a-z])/i.test(name);
  if (major < 5) return [];
  if (major === 6) {
    return /luna/i.test(name)
      ? ['none', 'low', 'medium', 'high', 'xhigh', 'max']
      : ['low', 'medium', 'high', 'xhigh', 'max'];
  }
  if (major !== 5) return null;
  if (minor >= 6) return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (minor >= 2) {
    return pro
      ? ['medium', 'high', 'xhigh']
      : ['none', 'low', 'medium', 'high', 'xhigh'];
  }
  if (minor === 1) return ['none', 'low', 'medium', 'high'];
  return pro ? ['high'] : ['minimal', 'low', 'medium', 'high'];
}

function claudeLevels(name: string): ReasoningEffort[] | null {
  if (!/claude/i.test(name)) return null;
  if (
    /claude-(?:fable|mythos|opus-5|sonnet-5|haiku-5|opus-4-[78])/i.test(name)
  ) {
    return CLAUDE_ALL;
  }
  if (/claude-(?:opus|sonnet)-4-6/i.test(name)) {
    return ['low', 'medium', 'high', 'max'];
  }
  if (/claude-opus-4-5/i.test(name)) return ['low', 'medium', 'high'];
  if (CLAUDE_REJECTS_EFFORT.test(name)) return [];
  return null;
}

/**
 * The levels `model` accepts, lowest first; `[]` when it takes no reasoning
 * effort. `model` is a bare name, a deployment name or a `provider/model` id.
 */
export function effortLevelsFor(model: string): ReasoningEffort[] {
  const name = model.trim();
  if (!name) return [];
  const gpt = gptLevels(name);
  if (gpt) return gpt;
  const claude = claudeLevels(name);
  if (claude) return claude;
  if (O_SERIES.test(name)) return ['low', 'medium', 'high'];
  return FALLBACK;
}

/** `high` when the model offers it, else its first level. */
export function defaultEffort(
  levels: ReasoningEffort[],
): ReasoningEffort | null {
  if (!levels.length) return null;
  return levels.includes('high') ? 'high' : levels[0];
}

/**
 * The level of `levels` closest to `effort` on the scale; ties go to the
 * higher level. `levels` must be non-empty.
 */
export function nearestEffort(
  levels: ReasoningEffort[],
  effort: ReasoningEffort,
): ReasoningEffort {
  if (levels.includes(effort)) return effort;
  const at = EFFORT_SCALE.indexOf(effort);
  let best = levels[0];
  for (const level of levels) {
    const distance = Math.abs(EFFORT_SCALE.indexOf(level) - at);
    const bestDistance = Math.abs(EFFORT_SCALE.indexOf(best) - at);
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        EFFORT_SCALE.indexOf(level) > EFFORT_SCALE.indexOf(best))
    ) {
      best = level;
    }
  }
  return best;
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (EFFORT_SCALE as readonly unknown[]).includes(value);
}
