import {
  agentTabIds,
  brokenLinkMessage,
  brokenLinks,
  defaultAgentTab,
  draftLinks,
  promptSaveInput,
  skillLinked,
  skillsCount,
} from './agent-page.util';
import { knownLinks } from './prompt-links';

describe('agent page util', () => {
  it('orders the tabs and drops the Chat Box for System agents', () => {
    expect(agentTabIds('user')).toEqual([
      'chat',
      'prompt',
      'skills',
      'tools',
      'graph',
      'memory',
      'evals',
      'model',
    ]);
    expect(agentTabIds('official')[0]).toBe('chat');
    expect(agentTabIds('system')).not.toContain('chat');
  });

  it('opens on the Chat Box, or on System Prompt for System agents', () => {
    expect(defaultAgentTab('user')).toBe('chat');
    expect(defaultAgentTab('official')).toBe('chat');
    expect(defaultAgentTab('system')).toBe('prompt');
  });

  it('finds broken links and words the error', () => {
    const known = knownLinks([{ name: 'planner' }]);
    const links = draftLinks(
      'Use [[skill:planner]] [[skill:ghost]] [[tool:nope]] [[skill:ghost]]',
      known,
    );
    expect(links.map((l) => `${l.kind}:${l.name}:${l.exists}`)).toEqual([
      'skill:planner:true',
      'skill:ghost:false',
      'tool:nope:false',
    ]);
    expect(brokenLinkMessage(brokenLinks(links))).toBe(
      'No skill named ghost (and others). Remove the link or create the skill on the Skills tab.',
    );
    expect(brokenLinkMessage([])).toBeNull();
    expect(
      brokenLinkMessage(brokenLinks(draftLinks('[[skill:ghost]]', known))),
    ).toBe(
      'No skill named ghost. Remove the link or create the skill on the Skills tab.',
    );
  });

  it('saves the draft with its other fields unchanged', () => {
    const input = promptSaveInput(
      {
        name: 'Fan',
        description: 'About fans',
        instructions: 'old',
        datasets: ['world-cup'],
        starterQuestions: ['Who won?'],
        model: 'gpt-x',
        reasoningEffort: 'low',
      },
      'new [[tool:sample_rows]]',
    );
    expect(input).toEqual({
      name: 'Fan',
      description: 'About fans',
      instructions: 'new [[tool:sample_rows]]',
      datasets: ['world-cup'],
      starterQuestions: ['Who won?'],
      model: 'gpt-x',
      reasoningEffort: 'low',
    });
  });

  it('marks a skill linked from the instructions and counts it with the built-ins', () => {
    const text = 'Use [[skill:planner]] and [[skill:ghost]]';
    expect(skillLinked(text, 'planner')).toBe(true);
    expect(skillLinked(text, 'budget')).toBe(false);
    const library = [{ name: 'planner' }, { name: 'budget' }];
    expect(skillsCount(text, library, 2)).toBe(3);
    expect(skillsCount('', library, 2)).toBe(2);
  });
});
