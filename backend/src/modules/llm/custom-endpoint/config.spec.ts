import type { ApiStyle } from '../llm.types';
import { isCustomAnthropicConfig } from '../../../mastra/model-resolver';
import { customModelConfig, endpointHost, normalizeBaseUrl } from './config';
import { BASE_URL_INVALID } from './messages';

// model-resolver imports model-factory (@ai-sdk/anthropic); keep Jest off it.
jest.mock('../../../mastra/model-factory', () => ({ buildModel: jest.fn() }));

describe('normalizeBaseUrl (R45, R46)', () => {
  const cases: Array<[ApiStyle, string, string]> = [
    // OpenAI style: as given, minus trailing slashes (R45).
    ['openai', 'http://127.0.0.1:8317/v1', 'http://127.0.0.1:8317/v1'],
    ['openai', 'http://127.0.0.1:8317/v1/', 'http://127.0.0.1:8317/v1'],
    ['openai', 'http://127.0.0.1:8317/v1///', 'http://127.0.0.1:8317/v1'],
    ['openai', '  http://localhost:11434/v1  ', 'http://localhost:11434/v1'],
    [
      'openai',
      'https://gw.example.com/api/v1',
      'https://gw.example.com/api/v1',
    ],
    // Not corrected: a URL without its version path stays as typed.
    ['openai', 'http://127.0.0.1:8317', 'http://127.0.0.1:8317'],
    ['openai', 'http://127.0.0.1:8317/', 'http://127.0.0.1:8317'],
    ['openai', 'HTTPS://Example.com/v1', 'HTTPS://Example.com/v1'],
    ['openai', 'http://10.0.0.5:8000/v1', 'http://10.0.0.5:8000/v1'],
    ['openai', 'http://[::1]:8317/v1', 'http://[::1]:8317/v1'],
    // Anthropic style: root plus /v1, unless it already ends in /v1 (R46).
    ['anthropic', 'http://127.0.0.1:8317', 'http://127.0.0.1:8317/v1'],
    ['anthropic', 'http://127.0.0.1:8317/', 'http://127.0.0.1:8317/v1'],
    ['anthropic', 'http://127.0.0.1:8317//', 'http://127.0.0.1:8317/v1'],
    ['anthropic', 'http://127.0.0.1:8317/v1', 'http://127.0.0.1:8317/v1'],
    ['anthropic', 'http://127.0.0.1:8317/v1/', 'http://127.0.0.1:8317/v1'],
    [
      'anthropic',
      ' https://relay.example.com ',
      'https://relay.example.com/v1',
    ],
    [
      'anthropic',
      'https://relay.example.com/anthropic',
      'https://relay.example.com/anthropic/v1',
    ],
    // `/v10` does not end in `/v1`.
    ['anthropic', 'http://host/v10', 'http://host/v10/v1'],
  ];

  it.each(cases)('%s %j → %j', (style, input, expected) => {
    expect(normalizeBaseUrl(style, input)).toBe(expected);
  });

  const invalid: string[] = [
    '',
    '   ',
    '127.0.0.1:8317/v1',
    'localhost:11434',
    'ftp://example.com/v1',
    'file:///etc/passwd',
    'ws://127.0.0.1:8317',
    'javascript:alert(1)',
    'http:example.com',
    'http://',
    'https://',
    'not a url',
    '/v1',
  ];

  describe.each<ApiStyle>(['openai', 'anthropic'])('%s style', (style) => {
    it.each(invalid)('rejects %j with BASE_URL_INVALID', (input) => {
      expect(() => normalizeBaseUrl(style, input)).toThrow(
        new Error(BASE_URL_INVALID),
      );
    });

    it('rejects a non-string with BASE_URL_INVALID', () => {
      expect(() =>
        normalizeBaseUrl(style, undefined as unknown as string),
      ).toThrow(BASE_URL_INVALID);
    });
  });
});

describe('customModelConfig (R27, R47)', () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof customModelConfig>[0];
    expected: unknown;
  }> = [
    {
      name: 'openai style with a key',
      input: {
        apiStyle: 'openai',
        baseUrl: 'http://127.0.0.1:8317/v1/',
        model: 'llama3',
        apiKey: 'sk-local',
      },
      expected: {
        id: 'custom/llama3',
        url: 'http://127.0.0.1:8317/v1',
        apiKey: 'sk-local',
      },
    },
    {
      name: 'openai style keyless (no Authorization header)',
      input: {
        apiStyle: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5:7b',
      },
      expected: {
        id: 'custom/qwen2.5:7b',
        url: 'http://localhost:11434/v1',
        apiKey: '',
      },
    },
    {
      name: 'openai style with a blank key is keyless',
      input: {
        apiStyle: 'openai',
        baseUrl: 'http://localhost:11434/v1',
        model: 'm',
        apiKey: '   ',
      },
      expected: {
        id: 'custom/m',
        url: 'http://localhost:11434/v1',
        apiKey: '',
      },
    },
    {
      name: 'openai style model with a slash',
      input: {
        apiStyle: 'openai',
        baseUrl: 'https://vllm.internal/v1',
        model: 'meta-llama/Llama-3-8B',
        apiKey: 'k',
      },
      expected: {
        id: 'custom/meta-llama/Llama-3-8B',
        url: 'https://vllm.internal/v1',
        apiKey: 'k',
      },
    },
    {
      name: 'anthropic style with a key, root URL',
      input: {
        apiStyle: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317/',
        model: 'claude-sonnet-4-5',
        apiKey: 'sk-ant',
      },
      expected: {
        kind: 'custom-anthropic',
        id: 'anthropic/claude-sonnet-4-5',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKey: 'sk-ant',
      },
    },
    {
      name: 'anthropic style keyless, URL already ending in /v1',
      input: {
        apiStyle: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317/v1/',
        model: 'claude-haiku-4-5',
      },
      expected: {
        kind: 'custom-anthropic',
        id: 'anthropic/claude-haiku-4-5',
        baseUrl: 'http://127.0.0.1:8317/v1',
      },
    },
    {
      name: 'anthropic style with an empty key omits it',
      input: {
        apiStyle: 'anthropic',
        baseUrl: 'https://relay.example.com',
        model: 'claude-opus-4-1',
        apiKey: '',
      },
      expected: {
        kind: 'custom-anthropic',
        id: 'anthropic/claude-opus-4-1',
        baseUrl: 'https://relay.example.com/v1',
      },
    },
  ];

  it.each(cases)('$name', ({ input, expected }) => {
    expect(customModelConfig(input)).toStrictEqual(expected);
  });

  it('keeps a keyless anthropic config free of an apiKey property', () => {
    const config = customModelConfig({
      apiStyle: 'anthropic',
      baseUrl: 'http://127.0.0.1:8317',
      model: 'm',
    });
    expect(config).not.toHaveProperty('apiKey');
  });

  it('marks only the anthropic style as custom-anthropic', () => {
    const base = { baseUrl: 'http://127.0.0.1:8317/v1', model: 'm' };
    expect(
      isCustomAnthropicConfig(
        customModelConfig({ ...base, apiStyle: 'anthropic' }),
      ),
    ).toBe(true);
    expect(
      isCustomAnthropicConfig(
        customModelConfig({ ...base, apiStyle: 'openai' }),
      ),
    ).toBe(false);
  });

  it('sets no extra headers on the openai route', () => {
    const config = customModelConfig({
      apiStyle: 'openai',
      baseUrl: 'http://127.0.0.1:8317/v1',
      model: 'm',
      apiKey: 'k',
    });
    expect(config).not.toHaveProperty('headers');
  });

  it.each<ApiStyle>(['openai', 'anthropic'])(
    '%s style throws BASE_URL_INVALID for a non-http URL',
    (apiStyle) => {
      expect(() =>
        customModelConfig({ apiStyle, baseUrl: 'ftp://host', model: 'm' }),
      ).toThrow(BASE_URL_INVALID);
    },
  );
});

describe('endpointHost', () => {
  it.each([
    ['http://127.0.0.1:8317/v1', '127.0.0.1:8317'],
    ['https://relay.example.com', 'relay.example.com'],
    ['https://relay.example.com:443/v1', 'relay.example.com'],
    ['not a url', 'not a url'],
  ])('%j → %j', (input, expected) => {
    expect(endpointHost(input)).toBe(expected);
  });
});
