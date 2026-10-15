import { RequestContext } from '@mastra/core/request-context';
import {
  AGENT_SKILLS_CONTEXT_KEY,
  agentSkillsFrom,
  renderSkillDocument,
  type AgentSkill,
} from './agent-skills';

const fiscal: AgentSkill = {
  id: 's1',
  name: 'fiscal-calendar',
  description: 'Use when a question names a fiscal year.',
  body: 'Our fiscal year starts on 1 July. See references/quarters.md.',
  files: [
    { path: 'references/quarters.md', content: 'Q1 is July to September.' },
  ],
};

describe('agentSkillsFrom', () => {
  it('reads the skills off the context, and is undefined without any', () => {
    const context = new RequestContext();
    expect(agentSkillsFrom(context)).toBeUndefined();
    expect(agentSkillsFrom(undefined)).toBeUndefined();
    context.set(AGENT_SKILLS_CONTEXT_KEY, []);
    expect(agentSkillsFrom(context)).toBeUndefined();
    context.set(AGENT_SKILLS_CONTEXT_KEY, [fiscal]);
    expect(agentSkillsFrom(context)).toEqual([fiscal]);
  });
});

describe('renderSkillDocument', () => {
  it('writes the front matter, a blank line, then the body', () => {
    expect(renderSkillDocument(fiscal)).toBe(
      `---\nname: fiscal-calendar\ndescription: Use when a question names a fiscal year.\n---\n\n${fiscal.body}`,
    );
  });
});
