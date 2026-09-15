import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import {
  setAgentModelResolver,
  type AgentModelConfig,
} from '../../mastra/model-resolver';
import { LlmSettingsRepository } from './repositories/llm-settings.repository';
import {
  LlmProvider,
  LlmSettingsView,
  REASONING_EFFORTS,
  ReasoningEffort,
  SaveLlmSettingsDto,
  SUPPORTED_PROVIDERS,
} from './llm.types';

const TEST_PROMPT = 'Reply with the single word: ok';
const TEST_TIMEOUT_MS = 30_000;
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

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

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly repository: LlmSettingsRepository,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit(): void {
    // Install the Mastra agent-model resolver: agents call this at generate
    // time, so saved settings apply immediately without a restart.
    setAgentModelResolver(() => this.resolveAgentModel());
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
    return { id: `openai/${doc.model}`, apiKey };
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

  /** Runs a fixed, cheap prompt through the provider to prove the wiring end-to-end. */
  async testConnection(dto: SaveLlmSettingsDto): Promise<LlmTestResult> {
    const { provider, model, baseUrl } = this.validate(dto);
    const apiKey = await this.resolveApiKey(dto);
    const lenaiConfig =
      provider === 'lenai'
        ? lenaiModelConfig({ model, baseUrl, apiKey })
        : null;
    const url = `${lenaiConfig?.url ?? OPENAI_BASE_URL}/chat/completions`;

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
          // Newer OpenAI models reject `max_tokens` (renamed to
          // `max_completion_tokens`). Generous cap: reasoning models spend
          // completion tokens on thinking before emitting the reply.
          max_completion_tokens: 512,
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
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = (json.choices?.[0]?.message?.content ?? '').trim();
    this.logger.log(`[testConnection] SUCCESS — reply="${reply}"`);
    return {
      provider,
      model,
      latencyMs: Date.now() - started,
      reply,
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
    const baseUrl = (dto.baseUrl ?? '').trim();
    if (provider === 'lenai' && !baseUrl) {
      throw new BadRequestException('baseUrl is required for lenai');
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
