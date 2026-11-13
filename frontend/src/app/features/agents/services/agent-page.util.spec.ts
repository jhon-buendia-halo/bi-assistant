import {
  AGENT_TAB_ORDER,
  agentTabIds,
  brokenLinkMessage,
  brokenLinks,
  defaultAgentTab,
  draftLinks,
  promptSaveInput,
  includedInEveryAgent,
  skillLinked,
  skillsCount,
  usedInEmptyText,
} from './agent-page.util';
import { knownLinks } from './prompt-links';

describe('agent page util', () => {
  it('orders the tabs and keeps Try it for user agents only (R5, R90)', () => {
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
    expect(agentTabIds('official')).not.toContain('chat');
    expect(agentTabIds('official')[0]).toBe('prompt');
    expect(agentTabIds('system')).not.toContain('chat');
    expect(
      AGENT_TAB_ORDER.find((tab) => tab.id === 'chat')?.label,
    ).toBe('Try it');
  });

  it('opens a user agent on Try it and every built-in agent on System Prompt (R5, R91)', () => {
    expect(defaultAgentTab('user')).toBe('chat');
    expect(defaultAgentTab('official')).toBe('prompt');
    expect(defaultAgentTab('system')).toBe('prompt');
  });

  it('words the empty Used in line per agent kind (R109)', () => {
    expect(usedInEmptyText('user')).toBe('Not used in any workflow.');
    expect(usedInEmptyText('system')).toBe(
      'Not used in any workflow. The app calls this agent itself.',
    );
    expect(usedInEmptyText('official')).toBe('Not used in any workflow.');
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

  it("lists only the built-in skills every agent gets, not an Official agent's own (R75)", () => {
    const builtIn = [
      { name: 'curated-knowledge', agents: ['assistant'] },
      { name: 'interactive-visuals', agents: ['visualization'] },
      { name: 'report-carriers', agents: ['report'] },
    ];
    expect(includedInEveryAgent(builtIn).map((skill) => skill.name)).toEqual([
      'curated-knowledge',
      'interactive-visuals',
    ]);
  });
});
