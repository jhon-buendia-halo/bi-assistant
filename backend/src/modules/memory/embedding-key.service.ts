import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  type EmbeddingKey,
  type EmbeddingKeyResolver,
  embeddingKeyFrom,
} from './embedding-key';

/**
 * Resolves the memory's embedding key per call, so a key saved in Settings
 * or a provider switched there applies to the next embedding without a
 * restart.
 */
@Injectable()
export class EmbeddingKeyService implements EmbeddingKeyResolver {
  constructor(private readonly llm: LlmService) {}

  async resolve(): Promise<EmbeddingKey> {
    return embeddingKeyFrom(await this.llm.openAiApiKey(), process.env);
  }
}
