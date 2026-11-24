import { savedLlmLabel } from './eval-cli-run';

describe('savedLlmLabel', () => {
  it('falls back to the env default when nothing is saved', () => {
    expect(savedLlmLabel({ provider: null, model: null })).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(savedLlmLabel({ provider: 'copilot', model: 'gpt-5' })).toEqual({
      provider: 'copilot',
      model: 'gpt-5',
    });
  });
});
