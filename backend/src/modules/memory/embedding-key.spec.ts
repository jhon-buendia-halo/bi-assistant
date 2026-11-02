import { embeddingKeyFrom } from './embedding-key';

describe('embeddingKeyFrom (contract 1.4)', () => {
  it('takes the key saved in the LLM settings first', () => {
    expect(embeddingKeyFrom('sk-saved', { OPENAI_API_KEY: 'sk-env' })).toEqual({
      source: 'llm-settings',
      apiKey: 'sk-saved',
    });
  });

  it('falls back to OPENAI_API_KEY, quotes stripped', () => {
    for (const value of ['sk-env', "sk-env'", '"sk-env"', "  'sk-env  "]) {
      expect(embeddingKeyFrom(undefined, { OPENAI_API_KEY: value })).toEqual({
        source: 'environment',
        apiKey: 'sk-env',
      });
    }
  });

  it('has none without either', () => {
    expect(embeddingKeyFrom('  ', { OPENAI_API_KEY: "''" })).toEqual({
      source: 'none',
    });
    expect(embeddingKeyFrom(undefined, {})).toEqual({ source: 'none' });
  });
});
