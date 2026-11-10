/**
 * The memory arm run option (agents-evals R231, R232): which cross-session
 * memory a run's attempts run with. `none` by default, which is what every
 * run did before the option; `mastra` ("Mastra only") or `hindsight-mastra`
 * ("Hindsight + Mastra"). Whether this build has the arm's memory, and
 * whether the agent may run with one, is the run service's to check (R19
 * step 10); this module only reads the value.
 *
 * Pure module: no Nest, no Mastra, no model.
 */
import { MEMORY_ARMS } from './memory-case';
import type { EvalArm, MemoryArm } from './memory-case';

/** How a run saved before the option existed reads: no memory (R231). */
export const LEGACY_ARM: Readonly<EvalArm> = Object.freeze({ memory: 'none' });

export type MemoryArmResult = { memory: MemoryArm } | { error: string };
export type EvalArmResult = { arm: EvalArm } | { error: string };

/** A string as written, anything else JSON-encoded (as R209 writes it). */
function shown(value: unknown): string {
  return typeof value === 'string' ? value : String(JSON.stringify(value));
}

function refused(value: unknown): { error: string } {
  return {
    error: `Unknown memory arm "${shown(value)}"; use none, mastra or hindsight-mastra`,
  };
}

/**
 * Read the memory arm as the API receives it (`arm.memory`, api.md endpoint
 * 36): missing (or `null`) is `none`, and only the three names are taken, as
 * strings, exactly as written.
 */
export function parseMemoryArm(value: unknown): MemoryArmResult {
  if (value === undefined || value === null) return { memory: 'none' };
  if (typeof value !== 'string') return refused(value);
  const memory = MEMORY_ARMS.find((arm) => arm === value);
  return memory ? { memory } : refused(value);
}

/**
 * The start request's `arm` (api.md endpoint 36): missing, `null` or with no
 * `memory` is `{ memory: 'none' }`; an object's `memory` is read by
 * `parseMemoryArm`; anything else is refused as an unknown memory arm.
 */
export function parseEvalArm(value: unknown): EvalArmResult {
  if (value === undefined || value === null) return { arm: { ...LEGACY_ARM } };
  if (typeof value !== 'object' || Array.isArray(value)) return refused(value);
  const memory = parseMemoryArm((value as { memory?: unknown }).memory);
  return 'error' in memory ? memory : { arm: { memory: memory.memory } };
}

/**
 * The command line's `EVAL_MEMORY`, read as text (R232): unset or blank is
 * `none`; otherwise one of the three names, trimmed.
 */
export function memoryArmFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): MemoryArmResult {
  const value = env['EVAL_MEMORY']?.trim() ?? '';
  if (!value) return { memory: 'none' };
  return parseMemoryArm(value);
}
