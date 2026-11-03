import type { ApiStyle, ListModelsResult } from '../llm.types';

// List a custom endpoint's models (unit 6, BA-287). Never throws.

export function listEndpointModels(options: {
  apiStyle: ApiStyle;
  /** Already normalised (`normalizeBaseUrl`). */
  baseUrl: string;
  apiKey?: string;
}): Promise<ListModelsResult> {
  void options;
  return Promise.resolve({
    ok: false,
    message: 'Model listing is not implemented yet (BA-281 scaffold)',
  });
}
