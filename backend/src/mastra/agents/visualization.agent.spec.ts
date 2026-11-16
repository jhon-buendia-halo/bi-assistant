// @mastra/core/agent pulls in ESM-only packages Jest cannot require, and the
// session-workspaces module drags the Mastra workspace in with it; neither is
// under test here, so both are stubbed.
jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));
jest.mock('../session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
}));

import { setAgentModelResolver } from '../model-resolver';
import { resolveVisualizationModel } from './visualization.agent';

/** agents.md 1.5: the visual designer's model, derived from the resolved one. */
describe('resolveVisualizationModel', () => {
  const originalVisualModel = process.env.VISUAL_MODEL;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.VISUAL_MODEL;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    if (originalVisualModel === undefined) delete process.env.VISUAL_MODEL;
    else process.env.VISUAL_MODEL = originalVisualModel;
  });

  const resolvedFrom = (configured: unknown) => {
    setAgentModelResolver(() => Promise.resolve(configured as never));
    return resolveVisualizationModel();
  };

  const customOpenAi = {
    id: 'custom/gpt-5-nano',
    apiKey: 'sk-secret',
    url: 'http://localhost:8080/v1',
  };
  const customAnthropic = {
    kind: 'custom-anthropic' as const,
    id: 'anthropic/claude-sonnet-4-5' as const,
    baseUrl: 'http://localhost:8080/v1',
    apiKey: 'sk-ant-secret',
  };

  describe('GitHub Copilot', () => {
    it('is never swapped, even for a nano or gpt-5 model', async () => {
      for (const id of [
        'copilot/gpt-5-nano',
        'copilot/gpt-5',
        'copilot/auto',
      ]) {
        const config = { kind: 'copilot' as const, id };
        await expect(resolvedFrom(config)).resolves.toEqual(config);
      }
      expect(warn).not.toHaveBeenCalled();
    });

    it('VISUAL_MODEL moves only the model name, keeping the kind', async () => {
      process.env.VISUAL_MODEL = 'openai/gpt-4.1';
      await expect(
        resolvedFrom({ kind: 'copilot', id: 'copilot/auto' }),
      ).resolves.toEqual({ kind: 'copilot', id: 'copilot/gpt-4.1' });
    });
  });

  describe('public and gateway models (unchanged behaviour)', () => {
    it('swaps a gpt-5 router id for the mini fallback', async () => {
      await expect(resolvedFrom('openai/gpt-5-mini')).resolves.toBe(
        'openai/gpt-4.1-mini',
      );
    });

    it('swaps an OpenAI object config without a url for the fallback, keeping its key', async () => {
      await expect(
        resolvedFrom({ id: 'openai/o3', apiKey: 'k' }),
      ).resolves.toEqual({ id: 'openai/gpt-4.1-mini', apiKey: 'k' });
    });

    it('never swaps a gateway deployment with a url to the fallback', async () => {
      const lenai = {
        id: 'openai/gpt-5',
        apiKey: 'k',
        url: 'https://gateway.example/v1',
      };
      await expect(resolvedFrom(lenai)).resolves.toEqual(lenai);
    });

    it('upgrades a nano router id and warns', async () => {
      await expect(resolvedFrom('openai/gpt-4.1-nano')).resolves.toBe(
        'openai/gpt-4.1-mini',
      );
      expect(warn).toHaveBeenCalledWith(
        '[visual-model] openai/gpt-4.1-nano is too weak for a visual spec; using openai/gpt-4.1-mini',
      );
    });

    it('keeps any other model', async () => {
      await expect(resolvedFrom('anthropic/claude-sonnet-4-5')).resolves.toBe(
        'anthropic/claude-sonnet-4-5',
      );
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('OpenAI-style custom endpoint', () => {
    it('upgrades a nano model to mini, keeping url and key', async () => {
      await expect(resolvedFrom(customOpenAi)).resolves.toEqual({
        ...customOpenAi,
        id: 'custom/gpt-5-mini',
      });
    });

    it('is never swapped to the public OpenAI fallback, even for a gpt-5 / o-series id', async () => {
      for (const id of ['openai/gpt-5', 'openai/o3', 'custom/gpt-5']) {
        const config = { ...customOpenAi, id };
        await expect(resolvedFrom(config)).resolves.toEqual(config);
      }
    });

    it('keeps a non-nano model as configured', async () => {
      const config = { id: 'custom/llama-3.1-70b', url: customOpenAi.url };
      await expect(resolvedFrom(config)).resolves.toEqual(config);
    });

    it('takes VISUAL_MODEL as the id, keeping url and key', async () => {
      process.env.VISUAL_MODEL = 'custom/qwen2.5-coder';
      await expect(resolvedFrom(customOpenAi)).resolves.toEqual({
        ...customOpenAi,
        id: 'custom/qwen2.5-coder',
      });
    });
  });

  describe('Anthropic-compatible custom endpoint', () => {
    it('keeps a non-nano model, kind, base URL and key', async () => {
      await expect(resolvedFrom(customAnthropic)).resolves.toEqual(
        customAnthropic,
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('upgrades a nano model to mini, keeping kind, base URL and key', async () => {
      await expect(
        resolvedFrom({ ...customAnthropic, id: 'anthropic/acme-nano-2' }),
      ).resolves.toEqual({ ...customAnthropic, id: 'anthropic/acme-mini-2' });
      expect(warn).toHaveBeenCalledWith(
        '[visual-model] anthropic/acme-nano-2 is too weak for a visual spec; using anthropic/acme-mini-2',
      );
    });

    it('takes only the model name from VISUAL_MODEL; the provider stays anthropic', async () => {
      process.env.VISUAL_MODEL = 'openai/claude-haiku-4-5';
      await expect(resolvedFrom(customAnthropic)).resolves.toEqual({
        ...customAnthropic,
        id: 'anthropic/claude-haiku-4-5',
      });
    });
  });

  describe('VISUAL_MODEL', () => {
    it('replaces a router id outright', async () => {
      process.env.VISUAL_MODEL = 'openai/gpt-4o';
      await expect(resolvedFrom('openai/gpt-5')).resolves.toBe('openai/gpt-4o');
    });

    it('replaces only the id of an object config, keeping url, key and headers', async () => {
      process.env.VISUAL_MODEL = 'lenai/gpt-41-mini';
      const lenai = {
        id: 'lenai/gpt-41-nano',
        apiKey: 'k',
        url: 'https://gateway.example/v1',
        headers: { 'x-a': 'b' },
      };
      await expect(resolvedFrom(lenai)).resolves.toEqual({
        ...lenai,
        id: 'lenai/gpt-41-mini',
      });
    });

    it('is read at call time, so unsetting it restores the derived model', async () => {
      process.env.VISUAL_MODEL = 'openai/gpt-4o';
      await expect(resolvedFrom('openai/gpt-4.1')).resolves.toBe(
        'openai/gpt-4o',
      );
      delete process.env.VISUAL_MODEL;
      await expect(resolvedFrom('openai/gpt-4.1')).resolves.toBe(
        'openai/gpt-4.1',
      );
    });
  });
});
