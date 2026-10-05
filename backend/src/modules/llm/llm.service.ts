import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import {
  setAgentModelResolver,
  setJudgeModelResolver,
  type AgentModelConfig,
} from '../../mastra/model-resolver';
import {
  providerOptionsFor as compatProviderOptionsFor,
  rejectsMaxTokens,
  type ProviderOptions,
} from '../../mastra/model-compat';
import { installRetryFetch } from './retry-fetch';
import { EngineSettingsService } from '../engine/engine-settings.service';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';
import {
  LlmProvider,
  LlmSettingsView,
  REASONING_EFFORTS,
  ReasoningEffort,
  SaveLlmSettingsDto,
  SUPPORTED_PROVIDERS,
} from './llm.types';

const TEST_PROMPT =
  'Reply with JSON matching the schema, using the value "ok" for `status`.';
const TEST_TIMEOUT_MS = 30_000;
const TEST_MAX_TOKENS = 512;
/**
 * gpt-5 / o-series count hidden reasoning against the same cap, and a
 * JSON-schema probe can spend well over 512 tokens thinking before it writes
 * a single visible character — OpenAI then returns 200 with empty content.
 */
const TEST_REASONING_MAX_TOKENS = 4096;
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Every agent in this app asks for `structuredOutput`, so the probe has to
 * prove the deployment honours a JSON schema — a model that only free-texts
 * tests green today and then fails on the first real turn.
 */
const TEST_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'connection_probe',
    strict: true,
    schema: {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
      additionalProperties: false,
    },
  },
} as const;

export interface LlmTestResult {
  provider: string;
  model: string;
  latencyMs: number;
  reply: string;
}

/**
 * Halo LenAI exposes deployments through an Azure OpenAI-compatible route.
 * Mastra appends `/chat/completions` to this deployment URL at request time.
 * LenAI requires its key as `X-Api-Key`; bearer auth is also supplied by the
 * OpenAI-compatible client.
 */
export function lenaiModelConfig(settings: {
  model: string;
  baseUrl: string;
  apiKey: string;
}) {
  const base = settings.baseUrl.replace(/\/+$/, '');
  return {
    id: `lenai/${settings.model}` as const,
    url: `${base}/openai/v1/deployments/${settings.model}`,
    apiKey: settings.apiKey,
    headers: { 'X-Api-Key': settings.apiKey },
  };
}

const ANTHROPIC_PROBE_SCHEMA = z.object({ status: z.string() });

/** HTTP status of a provider failure, looked up through the `cause` chain. */
function providerStatusCode(err: unknown): number | undefined {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The probe's `status` value, or null when the reply does not match the schema. */
function structuredReply(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const status = (parsed as { status?: unknown }).status;
  if (typeof status !== 'string' || !status.trim()) return null;
  return status.trim();
}

/**
 * Databricks Model Serving / Foundation Model APIs are OpenAI-compatible at
 * `https://<workspace-host>/serving-endpoints`, bearer-only — no extra
 * header like LenAI's `X-Api-Key`. `model` is the serving-endpoint name
 * (e.g. `databricks-claude-sonnet-4-5`, `databricks-gpt-oss-120b`, or a
 * custom endpoint), not a model family name.
 *
 * Verified against Mastra's model router so a config with `url` set takes
 * this exact path (`node_modules/@mastra/core/dist/llm-BHZjvbfj.js`,
 * mirrors what `lenaiModelConfig` already relies on):
 * - `ModelRouterLanguageModel.resolveAuth` (~L7905): when `this.config.url`
 *   is set it returns `{ apiKey: this.config.apiKey ?? '', headers:
 *   this.config.headers, source: 'explicit' }` — no gateway/env lookup, so
 *   only the `apiKey` passed here is ever sent.
 * - `resolveLanguageModel` (~L8011): when `this.config.url` is set it calls
 *   `createOpenAICompatible({ name: providerId, apiKey, baseURL:
 *   this.config.url, headers, supportsStructuredOutputs: true })
 *   .chatModel(modelId)`, where `providerId`/`modelId` are the router id
 *   (`this.config.id`, i.e. `databricks/<model>`) split at the first `/`
 *   (`GatewayManager.resolveModelId` → `parseModelRouterId`, ~L7578) —
 *   exactly how `lenai/<deployment>` already resolves.
 * - `createOpenAICompatible` (`node_modules/@mastra/core/dist/dist-_EYayO5k.js`
 *   ~L3805) builds request headers as `{ ...apiKey && { Authorization:
 *   \`Bearer ${apiKey}\` }, ...headers }` — bearer auth only when `headers`
 *   is omitted, confirming Databricks needs no `X-Api-Key`-style header —
 *   and its chat model config sets `path: '/chat/completions'` (~L4758), so
 *   the client requests `${baseURL}/chat/completions`; `baseURL` here must
 *   therefore be the bare `.../serving-endpoints` prefix with no trailing
 *   slash and no further path.
 */
export function databricksModelConfig(settings: {
  model: string;
  baseUrl: string;
  apiKey: string;
}) {
  return {
    id: `databricks/${settings.model}` as const,
    url: `${normalizeDatabricksBaseUrl(settings.baseUrl)}/serving-endpoints`,
    apiKey: settings.apiKey,
  };
}

/**
 * A Databricks workspace host, however an operator pasted it: trailing
 * slash(es) trimmed and a copied `.../serving-endpoints` suffix stripped
 * (a common paste from the workspace's "Serving" UI). `https://` is
 * required (Databricks does not serve over plain HTTP) and anything left
 * with its own path/query is rejected — appending `/serving-endpoints` to a
 * URL that already has a path would silently 404 or double up rather than
 * fail loudly at save time.
 */
export function normalizeDatabricksBaseUrl(raw: string): string {
  let host = (raw ?? '').trim().replace(/\/+$/, '');
  host = host.replace(/\/serving-endpoints\/?$/i, '');
  if (!/^https:\/\//i.test(host)) {
    throw new BadRequestException(
      'baseUrl must be an https:// Databricks workspace host, e.g. https://adb-1234567890123456.7.azuredatabricks.net',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(host);
  } catch {
    throw new BadRequestException(`baseUrl "${raw}" is not a valid URL`);
  }
  if (
    (parsed.pathname && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new BadRequestException(
      `baseUrl must be the workspace host only, with no path — got "${raw}"`,
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly repository: LlmSettingsRepository,
    private readonly crypto: CryptoService,
    private readonly engineSettings: EngineSettingsService,
  ) {}

  onModuleInit(): void {
    // Install the Mastra agent-model resolver: agents call this at generate
    // time, so saved settings apply immediately without a restart.
    setAgentModelResolver(() => this.resolveAgentModel());
    // Retry 429/5xx from the provider instead of failing an agent turn
    // outright — see retry-fetch.ts for why this has to patch the process's
    // global fetch rather than the agent model config.
    installRetryFetch();
    // Same for the eval judge — a pinned `EngineSettings.judgeModel` keeps
    // the ruler steady across assistant model changes; §resolveJudgeModelConfig.
    setJudgeModelResolver(() => this.resolveJudgeModelConfig());
  }

  /** Mastra model config from the persisted settings (decrypted key). */
  private async resolveAgentModel(): Promise<AgentModelConfig> {
    const doc = await this.repository.get();
    if (!doc) {
      // No settings yet — env-bound string router keeps the harness bootable.
      return 'openai/gpt-4o-mini';
    }
    const apiKey = this.crypto.decrypt(doc.apiKeyCiphertext);
    if (doc.provider === 'lenai') {
      return lenaiModelConfig({
        model: doc.model,
        baseUrl: doc.baseUrl,
        apiKey,
      });
    }
    if (doc.provider === 'anthropic') {
      return { id: `anthropic/${doc.model}`, apiKey };
    }
    if (doc.provider === 'databricks') {
      return databricksModelConfig({
        model: doc.model,
        baseUrl: doc.baseUrl,
        apiKey,
      });
    }
    return { id: `openai/${doc.model}`, apiKey };
  }

  /**
   * The model config the eval judge runs on. A pinned
   * `EngineSettings.judgeModel` (`<provider>/<model>` router id) wins when
   * its provider matches the configured LLM's provider — the judge then
   * reuses the same stored key/url/gateway, just a different model id, so
   * it still runs on the operator's own account. When the pinned provider
   * differs (or nothing is configured yet), there is no stored key for that
   * *other* provider to reuse, so it falls back to Mastra's env-bound
   * string router (`openai/gpt-4.1-mini` reads `OPENAI_API_KEY` the same
   * way the no-settings fallback above does) and logs one warning — silent
   * because a misconfigured pin should not fail every eval run, loud
   * because it is easy to not notice the judge quietly stopped being
   * pinned. No pin at all = the assistant's own configured model.
   */
  private async resolveJudgeModelConfig(): Promise<AgentModelConfig> {
    const pinned = (await this.engineSettings.judgeModel())?.trim();
    if (!pinned) return this.resolveAgentModel();

    const slash = pinned.indexOf('/');
    if (slash <= 0) {
      this.logger.warn(
        `judgeModel "${pinned}" is not a "<provider>/<model>" router id — using the assistant's own model instead`,
      );
      return this.resolveAgentModel();
    }
    const pinnedProvider = pinned.slice(0, slash);
    const pinnedModel = pinned.slice(slash + 1);

    const doc = await this.repository.get();
    if (doc && doc.provider === pinnedProvider) {
      const apiKey = this.crypto.decrypt(doc.apiKeyCiphertext);
      if (doc.provider === 'lenai') {
        return lenaiModelConfig({
          model: pinnedModel,
          baseUrl: doc.baseUrl,
          apiKey,
        });
      }
      if (doc.provider === 'databricks') {
        return databricksModelConfig({
          model: pinnedModel,
          baseUrl: doc.baseUrl,
          apiKey,
        });
      }
      return { id: pinned as `${string}/${string}`, apiKey };
    }

    this.logger.warn(
      `judgeModel "${pinned}" is a different provider than the configured LLM ("${doc?.provider ?? 'none configured'}") — running it via the env-bound router, not the saved key`,
    );
    return pinned as AgentModelConfig;
  }

  /**
   * `providerOptions` carrying a reasoning effort for `agent.generate` /
   * `agent.stream`, filed under the bucket the configured model actually reads
   * (`model-compat.providerOptionsFor`: `openai`, `lenai`, `anthropic` with
   * its own effort mapping, `databricks`). Mastra ignores a bucket that does
   * not match the resolved provider's name, which is how a hardcoded `openai`
   * key once made the reasoning-effort chip a no-op on LenAI.
   *
   * Databricks sends nothing by default — several serving endpoints reject an
   * unrecognised sampling parameter outright — unless the operator opted in
   * via `EngineSettings.databricksReasoningEffort`.
   */
  async providerOptionsFor(effort: ReasoningEffort): Promise<ProviderOptions> {
    const doc = await this.repository.get();
    if (
      doc?.provider === 'databricks' &&
      !(await this.engineSettings.databricksReasoningEffort())
    ) {
      return {};
    }
    return compatProviderOptionsFor(await this.resolveAgentModel(), {
      reasoningEffort: effort,
    });
  }

  async getView(): Promise<LlmSettingsView> {
    const doc = await this.repository.get();
    if (!doc) {
      return {
        provider: null,
        model: null,
        baseUrl: null,
        apiKeyMasked: null,
        reasoningEffort: 'high',
        configured: false,
      };
    }
    const key = this.crypto.decrypt(doc.apiKeyCiphertext);
    return {
      provider: doc.provider,
      model: doc.model,
      baseUrl: doc.baseUrl || null,
      apiKeyMasked: `••••••••${key.slice(-4)}`,
      reasoningEffort: doc.reasoningEffort ?? 'high',
      configured: true,
    };
  }

  async setReasoningEffort(effort: ReasoningEffort): Promise<LlmSettingsView> {
    if (!REASONING_EFFORTS.includes(effort)) {
      throw new BadRequestException(
        `reasoning effort must be one of: ${REASONING_EFFORTS.join(', ')}`,
      );
    }
    const patched = await this.repository.patch({ reasoningEffort: effort });
    if (!patched) {
      throw new BadRequestException(
        'Configure and save the LLM first — no settings stored yet',
      );
    }
    return this.getView();
  }

  async save(dto: SaveLlmSettingsDto): Promise<LlmSettingsView> {
    const { provider, model, baseUrl } = this.validate(dto);
    const apiKey = await this.resolveApiKey(dto);
    // Prove the settings actually work before persisting them — the Windows
    // diagnostics case that motivated this was a wrong Azure/LenAI
    // deployment name or baseUrl saved without ever having been tested,
    // which only surfaced as a user-visible 404 on the next agent turn.
    // testConnection throws with the same provider-error messages surfaced
    // by the dedicated test-connection endpoint, so save fails the same way.
    await this.testConnection({ provider, model, baseUrl, apiKey });
    const existing = await this.repository.get();
    await this.repository.save({
      provider,
      model,
      baseUrl,
      apiKeyCiphertext: this.crypto.encrypt(apiKey),
      reasoningEffort: existing?.reasoningEffort ?? 'high',
    });
    return this.getView();
  }

  /**
   * Runs a fixed, cheap prompt through the provider to prove the wiring
   * end-to-end. The body mirrors what an agent turn really sends — same cap
   * key, same structured-output request — so a green test means an agent call
   * with these settings will work. It stays a hand-rolled `fetch` on purpose:
   * the candidate settings are not persisted yet, and Mastra agents resolve
   * their model from the repository, so going through Mastra would test the
   * saved settings instead of the submitted ones.
   */
  async testConnection(dto: SaveLlmSettingsDto): Promise<LlmTestResult> {
    const { provider, model, baseUrl } = this.validate(dto);
    const apiKey = await this.resolveApiKey(dto);
    if (provider === 'anthropic') {
      return this.testAnthropicConnection(model, apiKey);
    }
    const lenaiConfig =
      provider === 'lenai'
        ? lenaiModelConfig({ model, baseUrl, apiKey })
        : null;
    const databricksConfig =
      provider === 'databricks'
        ? databricksModelConfig({ model, baseUrl, apiKey })
        : null;
    const url = `${lenaiConfig?.url ?? databricksConfig?.url ?? OPENAI_BASE_URL}/chat/completions`;
    // Same id the resolver builds, so `rejectsMaxTokens` judges the string it
    // will see at generate time.
    const modelId =
      lenaiConfig?.id ?? databricksConfig?.id ?? `openai/${model}`;
    // Newer OpenAI families renamed `max_tokens` to `max_completion_tokens`
    // and reject the old key; older deployments reject the new one. Mirror
    // whichever the model takes. The renamed families are the reasoning ones,
    // so they also get the larger cap. Databricks serving endpoints reject
    // `max_completion_tokens` (it is not part of the OpenAI-compatible
    // surface they implement) and always take `max_tokens`.
    const reasoning = rejectsMaxTokens(modelId);
    const capKey =
      reasoning && provider !== 'databricks'
        ? 'max_completion_tokens'
        : 'max_tokens';
    const cap = reasoning ? TEST_REASONING_MAX_TOKENS : TEST_MAX_TOKENS;

    this.logger.log(`[testConnection] ${provider}/${model} via ${url}`);
    const started = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(lenaiConfig?.headers ?? {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: TEST_PROMPT }],
          response_format: TEST_RESPONSE_FORMAT,
          [capKey]: cap,
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        msg.includes('abort')
          ? `LLM request timed out after ${TEST_TIMEOUT_MS / 1000}s`
          : `Provider unreachable — ${msg}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      if (res.status === 401) {
        throw new Error(`Authentication failed (401) — check the API key`);
      }
      if (provider === 'databricks' && res.status === 403) {
        throw new Error(
          `Access denied (403) — check the API key has access to serving endpoint "${model}"`,
        );
      }
      if (provider === 'databricks' && res.status === 404) {
        throw new Error(
          `Serving endpoint not found (404) — check the name "${model}"`,
        );
      }
      throw new Error(`Provider request failed (${res.status}) — ${body}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string | null; refusal?: string | null };
      }>;
    };
    const choice = json.choices?.[0];
    const content = (choice?.message?.content ?? '').trim();
    if (!content && choice?.finish_reason === 'length') {
      throw new Error(
        `Model hit the ${cap}-token limit before replying — reasoning models spend that budget thinking first; try a lower reasoning effort or a non-reasoning model`,
      );
    }
    if (!content && choice?.message?.refusal) {
      throw new Error(
        `Model refused the connection probe — ${choice.message.refusal.slice(0, 200)}`,
      );
    }
    // Distinct from the auth/status failures above: the credentials and the
    // parameters are fine, the deployment just cannot produce the structured
    // output every agent here depends on.
    const reply = structuredReply(content);
    if (reply === null) {
      throw new Error(
        `Model answered but could not produce structured JSON output, which every agent here requires — reply="${content.slice(0, 200)}"`,
      );
    }
    this.logger.log(`[testConnection] SUCCESS — reply="${reply}"`);
    return {
      provider,
      model,
      latencyMs: Date.now() - started,
      reply,
    };
  }

  /**
   * Anthropic's probe goes through a throwaway Mastra agent built on the
   * submitted model config, not a hand-rolled request: the Anthropic provider
   * decides per model how structured output is sent (native `output_config`
   * vs. a JSON tool) and which sampling parameters it strips, so only the
   * provider itself can prove an agent turn will work.
   */
  private async testAnthropicConnection(
    model: string,
    apiKey: string,
  ): Promise<LlmTestResult> {
    const modelId = `anthropic/${model}` as const;
    this.logger.log(`[testConnection] ${modelId}`);
    const probe = new Agent({
      id: 'llm-connection-probe',
      name: 'LLM connection probe',
      instructions: 'You answer connection probes exactly as asked.',
      model: { id: modelId, apiKey },
    });
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let status: unknown;
    try {
      const result = await probe.generate(TEST_PROMPT, {
        structuredOutput: { schema: ANTHROPIC_PROBE_SCHEMA },
        modelSettings: { maxOutputTokens: 512 },
        abortSignal: controller.signal,
      });
      status = (result.object as { status?: unknown } | undefined)?.status;
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `LLM request timed out after ${TEST_TIMEOUT_MS / 1000}s`,
        );
      }
      const statusCode = providerStatusCode(err);
      if (statusCode === 401) {
        throw new Error(`Authentication failed (401) — check the API key`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        statusCode
          ? `Provider request failed (${statusCode}) — ${msg.slice(0, 300)}`
          : `Provider unreachable — ${msg.slice(0, 300)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (typeof status !== 'string' || !status.trim()) {
      throw new Error(
        'Model answered but could not produce structured JSON output, which every agent here requires',
      );
    }
    this.logger.log(`[testConnection] SUCCESS — reply="${status.trim()}"`);
    return {
      provider: 'anthropic',
      model,
      latencyMs: Date.now() - started,
      reply: status.trim(),
    };
  }

  private validate(dto: SaveLlmSettingsDto): {
    provider: LlmProvider;
    model: string;
    baseUrl: string;
  } {
    const provider = dto.provider;
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      throw new BadRequestException(
        `provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
      );
    }
    const model = (dto.model ?? '').trim();
    if (!model) throw new BadRequestException('model is required');
    let baseUrl = (dto.baseUrl ?? '').trim();
    if (provider === 'lenai' && !baseUrl) {
      throw new BadRequestException('baseUrl is required for lenai');
    }
    if (provider === 'databricks') {
      if (!baseUrl) {
        throw new BadRequestException('baseUrl is required for databricks');
      }
      // Normalise (and reject) here, at save/test time, so the stored
      // document always holds a clean host — `databricksModelConfig` can
      // then build the serving-endpoints URL without re-deriving it from
      // whatever an operator originally pasted.
      baseUrl = normalizeDatabricksBaseUrl(baseUrl);
    }
    return { provider, model, baseUrl };
  }

  /** Body key when provided, otherwise the stored (decrypted) key. */
  private async resolveApiKey(dto: SaveLlmSettingsDto): Promise<string> {
    const supplied = (dto.apiKey ?? '').trim();
    if (supplied) return supplied;
    const doc = await this.repository.get();
    if (!doc) {
      throw new BadRequestException('apiKey is required — none stored yet');
    }
    return this.crypto.decrypt(doc.apiKeyCiphertext);
  }
}
