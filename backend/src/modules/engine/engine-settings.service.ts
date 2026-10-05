import { BadRequestException, Injectable } from '@nestjs/common';
import { ASSISTANT_RULE_GROUPS } from '../../mastra/agents/assistant-instructions';
import { EngineSettingsRepository } from './repositories/engine-settings.repository';
import {
  ARM_DESCRIPTIONS,
  ARM_PRESETS,
  ENGINE_DEFAULTS,
  ENGINE_OPTION_KEYS,
  resolveEngineOptions,
  sanitizeEngineOptions,
  type EngineOptions,
  type EngineSettingsDoc,
} from './engine-options';

/** Router id shape the judge model must satisfy: `<provider>/<model>`. */
const JUDGE_MODEL_PATTERN = /^[a-z0-9-]+\/[\w.:-]+$/i;

/** Body of `PUT /engine/settings`. */
export interface SaveEngineSettingsInput {
  /**
   * The full set of production levers as the Settings UI shows them; only
   * the ones that differ from `ENGINE_DEFAULTS` are persisted. Omitted
   * (rather than `{}`) leaves whatever is already stored untouched.
   */
  defaults?: unknown;
  /** `<provider>/<model>` router id, or `null`/`''` to clear back to "the assistant's own model". Omitted leaves the stored value untouched. */
  judgeModel?: string | null;
  databricksReasoningEffort?: boolean;
}

/** `GET /engine/settings` — everything the Settings → Engine levers page and the eval arm picker need. */
export interface EngineSettingsView {
  /** Production defaults, resolved: `ENGINE_DEFAULTS` overridden by `stored`. */
  defaults: EngineOptions;
  /** Only the levers an operator has changed from `ENGINE_DEFAULTS`. */
  stored: Partial<EngineOptions>;
  /** Today's engine, unaffected by anything an operator has saved. */
  productionDefaults: EngineOptions;
  judgeModel: string | null;
  databricksReasoningEffort: boolean;
  arms: Record<string, Partial<EngineOptions>>;
  armDescriptions: Record<string, string>;
  ruleGroups: { id: string; title: string; ablatable: boolean }[];
}

/**
 * Persisted production engine levers (Settings → Engine levers), read by
 * every chat turn (`SessionsService.agentContext`, U1-A) and by the eval
 * runner as the baseline an arm overrides. Depends only on the global
 * `DatabaseModule` (`SETTINGS_STORE`, shared with the LLM doc under a
 * different `key`) so `SessionsModule`, `AgentsModule` and `LlmModule` can
 * each import `EngineModule` without a cycle.
 */
@Injectable()
export class EngineSettingsService {
  constructor(private readonly repository: EngineSettingsRepository) {}

  get(): Promise<EngineSettingsDoc | null> {
    return this.repository.get();
  }

  /** Production defaults, resolved: `ENGINE_DEFAULTS` overridden by whatever was saved. */
  async resolved(): Promise<EngineOptions> {
    const doc = await this.repository.get();
    return resolveEngineOptions(doc?.defaults);
  }

  /** Router id the eval judge runs on; undefined = the assistant's own configured model. */
  async judgeModel(): Promise<string | undefined> {
    const doc = await this.repository.get();
    return doc?.judgeModel;
  }

  /** Whether `reasoningEffort` is sent to Databricks serving endpoints (off by default — many reject it). */
  async databricksReasoningEffort(): Promise<boolean> {
    const doc = await this.repository.get();
    return doc?.databricksReasoningEffort ?? false;
  }

  /**
   * Sanitizes `defaults` and stores only the levers that differ from
   * `ENGINE_DEFAULTS`, so a later change to the production defaults still
   * reaches every lever the operator never touched. Unknown or mistyped
   * levers are dropped (`sanitizeEngineOptions`), never persisted.
   * `judgeModel` must be a `<provider>/<model>` router id, or `null`/`''`
   * to clear it; an invalid one throws `BadRequestException` without
   * writing anything.
   */
  async save(input: SaveEngineSettingsInput): Promise<EngineSettingsView> {
    const existing = await this.repository.get();

    const storedDefaults =
      input.defaults !== undefined
        ? diffFromDefaults(sanitizeEngineOptions(input.defaults))
        : (existing?.defaults ?? {});

    let judgeModel = existing?.judgeModel;
    if (input.judgeModel !== undefined) {
      const trimmed = (input.judgeModel ?? '').trim();
      if (trimmed && !JUDGE_MODEL_PATTERN.test(trimmed)) {
        throw new BadRequestException(
          `judgeModel must be a "<provider>/<model>" router id (e.g. openai/gpt-4.1-mini), or empty to clear it — got "${trimmed}"`,
        );
      }
      // Explicitly `undefined` (not omitted) so the repository's merge drops
      // the field on write rather than keeping the previous value.
      judgeModel = trimmed || undefined;
    }

    const databricksReasoningEffort =
      input.databricksReasoningEffort !== undefined
        ? input.databricksReasoningEffort
        : (existing?.databricksReasoningEffort ?? false);

    const now = new Date().toISOString();
    await this.repository.save({
      defaults: storedDefaults,
      judgeModel,
      databricksReasoningEffort,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return this.view();
  }

  async view(): Promise<EngineSettingsView> {
    const doc = await this.repository.get();
    return {
      defaults: resolveEngineOptions(doc?.defaults),
      stored: doc?.defaults ?? {},
      productionDefaults: ENGINE_DEFAULTS,
      judgeModel: doc?.judgeModel ?? null,
      databricksReasoningEffort: doc?.databricksReasoningEffort ?? false,
      arms: ARM_PRESETS,
      armDescriptions: ARM_DESCRIPTIONS,
      ruleGroups: ASSISTANT_RULE_GROUPS.map(({ id, title, ablatable }) => ({
        id,
        title,
        ablatable,
      })),
    };
  }
}

/** Only the keys of `options` whose value differs from `ENGINE_DEFAULTS`. */
function diffFromDefaults(
  options: Partial<EngineOptions>,
): Partial<EngineOptions> {
  const diff: Partial<Record<keyof EngineOptions, unknown>> = {};
  for (const key of ENGINE_OPTION_KEYS) {
    if (!(key in options)) continue;
    const value = options[key];
    if (JSON.stringify(value) !== JSON.stringify(ENGINE_DEFAULTS[key])) {
      diff[key] = value;
    }
  }
  return diff as Partial<EngineOptions>;
}
