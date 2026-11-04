import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  CryptoService,
  UnreadableSecretError,
} from '../../infrastructure/crypto/crypto.service';
import {
  setAgentModelResolver,
  type AgentModelConfig,
} from '../../mastra/model-resolver';
import { rejectsMaxTokens } from '../../mastra/model-compat';
import {
  defaultEffort,
  effortLevelsFor,
  isReasoningEffort,
} from '../../mastra/effort-levels';
import { installRetryFetch } from './retry-fetch';
import {
  customModelConfig,
  endpointHost,
  normalizeBaseUrl,
} from './custom-endpoint/config';
import {
  API_STYLE_INVALID,
  BASE_URL_INVALID,
  BASE_URL_REQUIRED,
  MODELS_PROVIDER_INVALID,
} from './custom-endpoint/messages';
import { listEndpointModels } from './custom-endpoint/models';
import { probeOpenAiStyle } from './custom-endpoint/probe';
import { probeAnthropicStyle } from './custom-endpoint/probe-anthropic';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';
import {
  API_STYLES,
  ApiStyle,
  EffortLevelsView,
  LlmProvider,
  LlmSettingsDoc,
  LlmSettingsView,
  REASONING_EFFORTS,
  ReasoningEffort,
  SaveLlmSettingsDto,
  SUPPORTED_PROVIDERS,
  ListModelsDto,
  ListModelsResult,
} from './llm.types';

const API_KEY_REQUIRED_MESSAGE = 'apiKey is required — none stored yet';

const UNREADABLE_KEY_MESSAGE =
  "The saved API key can't be read because the app secret changed — enter it again in Settings → LLM Configuration";

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

/** A validated save/test request; `apiStyle` is set only for `custom`. */
interface ValidatedSettings {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiStyle?: ApiStyle;
}

/** A body string trimmed; anything else reads as blank. */
function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly repository: LlmSettingsRepository,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Install the Mastra agent-model resolver: agents call this at generate
    // time, so saved settings apply immediately without a restart.
    setAgentModelResolver((modelOverride) =>
      this.resolveAgentModel(modelOverride),
    );
    // Retry 429/5xx from the provider instead of failing an agent turn
    // outright — see retry-fetch.ts for why this has to patch the process's
    // global fetch rather than the agent model config.
    installRetryFetch();
    await this.reencryptFormerSecretKey();
  }

  /**
   * Migration M11: a key saved while the backend fell back to the fixed
   * development secret is re-encrypted with the current one, so the first
   * launch with a real secret does not lose it.
   */
  private async reencryptFormerSecretKey(): Promise<void> {
    try {
      const doc = await this.repository.get();
      // A keyless custom endpoint stores no ciphertext: nothing to migrate.
      if (!doc?.apiKeyCiphertext) return;
      const ciphertext = this.crypto.reencryptFormerSecret(
        doc.apiKeyCiphertext,
      );
      if (!ciphertext) return;
      await this.repository.patch({ apiKeyCiphertext: ciphertext });
      this.logger.log(
        'Re-encrypted the stored LLM API key with the current app secret',
      );
    } catch (err) {
      this.logger.warn(
        `Could not re-encrypt the stored LLM API key: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The stored key in plaintext, or a readable error when it cannot be. */
  private storedApiKey(doc: LlmSettingsDoc): string {
    if (!doc.apiKeyCiphertext) {
      // A keyless custom endpoint was saved last (R6 when switching away).
      throw new BadRequestException(API_KEY_REQUIRED_MESSAGE);
    }
    try {
      return this.crypto.decrypt(doc.apiKeyCiphertext);
    } catch (err) {
      if (err instanceof UnreadableSecretError) {
        throw new BadRequestException(UNREADABLE_KEY_MESSAGE);
      }
      throw err;
    }
  }

  /**
   * Mastra model config from the persisted settings (decrypted key).
   * `modelOverride` (a user agent's model) replaces the saved model or
   * deployment name; with nothing saved it is ignored.
   */
  private async resolveAgentModel(
    modelOverride?: string,
  ): Promise<AgentModelConfig> {
    const doc = await this.repository.get();
    if (!doc) {
      // No settings yet — env-bound string router keeps the harness bootable.
      return 'openai/gpt-4o-mini';
    }
    const model = modelOverride?.trim() || doc.model;
    if (doc.provider === 'custom') {
      // Keyless endpoints are called with no credential (R47).
      const apiKey = doc.apiKeyCiphertext ? this.storedApiKey(doc) : undefined;
      return customModelConfig({
        apiStyle: doc.apiStyle ?? 'openai',
        baseUrl: doc.baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
    }
    const apiKey = this.storedApiKey(doc);
    if (doc.provider === 'lenai') {
      return lenaiModelConfig({
        model,
        baseUrl: doc.baseUrl,
        apiKey,
      });
    }
    if (doc.provider === 'anthropic') {
      return { id: `anthropic/${model}`, apiKey };
    }
    return { id: `openai/${model}`, apiKey };
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
        apiStyle: null,
      };
    }
    const view = {
      provider: doc.provider,
      model: doc.model,
      baseUrl: doc.baseUrl || null,
      reasoningEffort: doc.reasoningEffort ?? 'high',
      apiStyle: doc.provider === 'custom' ? (doc.apiStyle ?? null) : null,
    };
    if (!doc.apiKeyCiphertext) {
      // Only a custom endpoint may be saved without a key (R47).
      return {
        ...view,
        apiKeyMasked: null,
        configured: doc.provider === 'custom',
      };
    }
    let key: string;
    try {
      key = this.crypto.decrypt(doc.apiKeyCiphertext);
    } catch (err) {
      if (!(err instanceof UnreadableSecretError)) throw err;
      return {
        ...view,
        apiKeyMasked: null,
        configured: false,
        keyUnreadable: true,
      };
    }
    return {
      ...view,
      apiKeyMasked: `••••••••${key.slice(-4)}`,
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
    const settings = this.validate(dto);
    const { provider, model, baseUrl, apiStyle } = settings;
    const existing = await this.repository.get();
    const apiKey = this.resolveApiKey(settings, dto.apiKey, existing);
    // Prove the settings actually work before persisting them — the Windows
    // diagnostics case that motivated this was a wrong Azure/LenAI
    // deployment name or baseUrl saved without ever having been tested,
    // which only surfaced as a user-visible 404 on the next agent turn.
    // testConnection throws with the same provider-error messages surfaced
    // by the dedicated test-connection endpoint, so save fails the same way.
    const reasoningEffort = this.effortToSave(
      model,
      dto.reasoningEffort,
      existing?.reasoningEffort,
    );
    await this.probe(settings, apiKey);
    // The repository replaces the doc: a keyless custom endpoint stores no
    // ciphertext (never an encrypted empty string) and only `custom` keeps
    // an API style.
    await this.repository.save({
      provider,
      model,
      baseUrl,
      ...(apiKey ? { apiKeyCiphertext: this.crypto.encrypt(apiKey) } : {}),
      ...(apiStyle ? { apiStyle } : {}),
      reasoningEffort,
    });
    return this.getView();
  }

  /** The effort levels `model` accepts, for the settings form. */
  effortLevels(model: string | undefined): EffortLevelsView {
    const levels = effortLevelsFor(model ?? '');
    return {
      levels,
      defaultEffort: defaultEffort(levels),
      probeEffort: levels[0] ?? null,
    };
  }

  /**
   * The effort a save stores: the chosen one, which must be among the
   * model's levels; else the stored one when the model takes it; else the
   * model's default. A model without levels keeps the stored value.
   */
  private effortToSave(
    model: string,
    chosen: unknown,
    stored: ReasoningEffort | undefined,
  ): ReasoningEffort {
    const levels = effortLevelsFor(model);
    if (chosen !== undefined && chosen !== null && chosen !== '') {
      if (!isReasoningEffort(chosen) || !levels.includes(chosen)) {
        throw new BadRequestException(
          `reasoning effort must be one of: ${levels.join(', ') || 'none for this model'}`,
        );
      }
      return chosen;
    }
    if (!levels.length) return stored ?? 'high';
    if (stored && levels.includes(stored)) return stored;
    return defaultEffort(levels) ?? 'high';
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
    const settings = this.validate(dto);
    const apiKey = this.resolveApiKey(
      settings,
      dto.apiKey,
      await this.repository.get(),
    );
    return this.probe(settings, apiKey);
  }

  /** Probes validated settings with the resolved key (undefined = keyless). */
  private async probe(
    settings: ValidatedSettings,
    apiKey: string | undefined,
  ): Promise<LlmTestResult> {
    const { provider, model, baseUrl, apiStyle } = settings;
    if (provider === 'custom') {
      return this.testCustomConnection(
        model,
        apiStyle ?? 'openai',
        baseUrl,
        apiKey,
      );
    }
    if (!apiKey) throw new BadRequestException(API_KEY_REQUIRED_MESSAGE);
    if (provider === 'anthropic') {
      return this.testAnthropicConnection(model, apiKey);
    }
    const lenaiConfig =
      provider === 'lenai'
        ? lenaiModelConfig({ model, baseUrl, apiKey })
        : null;
    const url = `${lenaiConfig?.url ?? OPENAI_BASE_URL}/chat/completions`;
    // Same id the resolver builds, so `rejectsMaxTokens` judges the string it
    // will see at generate time.
    const modelId = lenaiConfig?.id ?? `openai/${model}`;
    // Newer OpenAI families renamed `max_tokens` to `max_completion_tokens`
    // and reject the old key; older deployments reject the new one. Mirror
    // whichever the model takes. The renamed families are the reasoning ones,
    // so they also get the larger cap.
    const reasoning = rejectsMaxTokens(modelId);
    const capKey = reasoning ? 'max_completion_tokens' : 'max_tokens';
    const cap = reasoning ? TEST_REASONING_MAX_TOKENS : TEST_MAX_TOKENS;
    // The probe proves the wiring, not reasoning depth: at the model's lowest
    // level a reasoning model such as gpt-5 answers well inside the timeout.
    const probeEffort = effortLevelsFor(model)[0];

    this.logger.log(
      `[testConnection] ${provider}/${model} via ${url}${probeEffort ? ` (effort ${probeEffort})` : ''}`,
    );
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
          ...(probeEffort ? { reasoning_effort: probeEffort } : {}),
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
    const probeEffort = effortLevelsFor(model)[0];
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
        ...(probeEffort
          ? {
              providerOptions: {
                // Claude levels never include `none` or `minimal`.
                anthropic: {
                  effort: probeEffort as Exclude<
                    ReasoningEffort,
                    'none' | 'minimal'
                  >,
                },
              },
            }
          : {}),
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

  /**
   * A custom endpoint's probe (R49): the style's probe against the
   * normalised base URL, at the model's lowest effort level. The probes
   * throw the user-facing texts of R50 / R18 themselves.
   */
  private async testCustomConnection(
    model: string,
    apiStyle: ApiStyle,
    baseUrl: string,
    apiKey: string | undefined,
  ): Promise<LlmTestResult> {
    const url = normalizeBaseUrl(apiStyle, baseUrl);
    const effort = effortLevelsFor(model)[0];
    // Only the host is logged: a URL may carry credentials, a key never is.
    this.logger.log(
      `[testConnection] custom/${model} (${apiStyle}) via ${endpointHost(url)}${effort ? ` (effort ${effort})` : ''}`,
    );
    const probe =
      apiStyle === 'anthropic' ? probeAnthropicStyle : probeOpenAiStyle;
    const { reply, latencyMs } = await probe({
      baseUrl: url,
      model,
      ...(apiKey ? { apiKey } : {}),
      ...(effort ? { effort } : {}),
    });
    this.logger.log(`[testConnection] SUCCESS — reply="${reply}"`);
    return { provider: 'custom', model, latencyMs, reply };
  }

  /**
   * Validation in the order of R44 / api.md 30: provider, API style, base
   * URL presence, base URL form (custom only), model, then LenAI's base URL.
   * An API style sent for another provider is ignored (R5).
   */
  private validate(dto: SaveLlmSettingsDto): ValidatedSettings {
    const provider = dto.provider;
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      throw new BadRequestException(
        `provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
      );
    }
    const custom =
      provider === 'custom' ? this.validateCustomEndpoint(dto) : null;
    const model = trimmed(dto.model);
    if (!model) throw new BadRequestException('model is required');
    if (custom) return { provider, model, ...custom };
    const baseUrl = trimmed(dto.baseUrl);
    if (provider === 'lenai' && !baseUrl) {
      throw new BadRequestException('baseUrl is required for lenai');
    }
    return { provider, model, baseUrl };
  }

  /**
   * A custom endpoint's API style and base URL (R44); the base URL comes
   * back trimmed and without trailing slashes, as it is stored. Any host,
   * loopback and private addresses included, is accepted.
   */
  private validateCustomEndpoint(dto: {
    apiStyle?: unknown;
    baseUrl?: unknown;
  }): { apiStyle: ApiStyle; baseUrl: string } {
    const apiStyle = dto.apiStyle as ApiStyle;
    if (!API_STYLES.includes(apiStyle)) {
      throw new BadRequestException(API_STYLE_INVALID);
    }
    const raw = trimmed(dto.baseUrl);
    if (!raw) throw new BadRequestException(BASE_URL_REQUIRED);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new BadRequestException(BASE_URL_INVALID);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(BASE_URL_INVALID);
    }
    return { apiStyle, baseUrl: raw.replace(/\/+$/, '') };
  }

  /**
   * The key a request uses, given the stored settings `doc`. Custom: as
   * `customApiKey` (optional). Others: the body key when provided, otherwise
   * the stored (decrypted) key (R6) — but never a key stored for a custom
   * endpoint, which is not sent to a public provider.
   */
  private resolveApiKey(
    settings: ValidatedSettings,
    suppliedKey: unknown,
    doc: LlmSettingsDoc | null,
  ): string | undefined {
    if (settings.provider === 'custom') {
      return this.customApiKey(suppliedKey, doc);
    }
    const supplied = trimmed(suppliedKey);
    if (supplied) return supplied;
    if (!doc || doc.provider === 'custom') {
      throw new BadRequestException(API_KEY_REQUIRED_MESSAGE);
    }
    return this.storedApiKey(doc);
  }

  /**
   * A custom endpoint's key (R47): the typed one; else the stored key when
   * the stored provider is also custom and holds one; else none. A key
   * stored for another provider is never sent to a custom endpoint.
   */
  private customApiKey(
    suppliedKey: unknown,
    doc: LlmSettingsDoc | null,
  ): string | undefined {
    const supplied = trimmed(suppliedKey);
    if (supplied) return supplied;
    if (doc?.provider !== 'custom' || !doc.apiKeyCiphertext) return undefined;
    return this.storedApiKey(doc);
  }

  /**
   * `POST /llm/models` (R48, api.md 32b): list a custom endpoint's models
   * before saving. Validated as R44, key as R47; nothing is persisted.
   * Every failure answers in the body (Style A).
   */
  async listModels(dto: ListModelsDto): Promise<ListModelsResult> {
    try {
      if (dto?.provider !== 'custom') {
        throw new BadRequestException(MODELS_PROVIDER_INVALID);
      }
      const { apiStyle, baseUrl } = this.validateCustomEndpoint(dto);
      const apiKey = this.customApiKey(dto.apiKey, await this.repository.get());
      return await listEndpointModels({
        apiStyle,
        baseUrl: normalizeBaseUrl(apiStyle, baseUrl),
        ...(apiKey ? { apiKey } : {}),
      });
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
