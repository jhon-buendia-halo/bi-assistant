import { RequestContext } from '@mastra/core/request-context';
import type { AppSkill } from './app-skills';
import {
  AGENT_SKILLS_CONTEXT_KEY,
  agentSkillsFrom,
  inAppLocation,
  mergedCatalog,
  readInAppPath,
  renderSkillDocument,
  type AgentSkill,
} from './agent-skills';

const fiscal: AgentSkill = {
  id: 's1',
  name: 'fiscal-calendar',
  description: 'Use when a question names a fiscal year.',
  body: 'Our fiscal year starts on 1 July. See reference/quarters.md.',
  files: [
    { path: 'reference/quarters.md', content: 'Q1 is July to September.' },
  ],
};

const folderSkill = (name: string, level: AppSkill['level']): AppSkill => ({
  name,
  description: `Use when ${name}.`,
  dir: `/skills/${name}`,
  document: '',
  level,
  loading: 'on-demand',
  agents: ['assistant'],
  overrides: [],
  warnings: [],
});

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

describe('mergedCatalog', () => {
  it('adds the agent skills and lets one replace a same-named user skill', () => {
    const merged = mergedCatalog(
      [
        folderSkill('curated-knowledge', 'built-in'),
        folderSkill('fiscal-calendar', 'user'),
      ],
      [fiscal],
    );
    expect(merged.map((entry) => entry.name)).toEqual([
      'curated-knowledge',
      'fiscal-calendar',
    ]);
    const entry = merged.find((e) => e.name === 'fiscal-calendar')!;
    expect(entry.location).toBe('/in-app-skills/fiscal-calendar/SKILL.md');
    expect(entry.description).toBe(fiscal.description);
    expect(inAppLocation('x')).toBe('/in-app-skills/x/SKILL.md');
  });
});

describe('readInAppPath', () => {
  it('answers SKILL.md rendered, and a reference file as stored', () => {
    expect(readInAppPath([fiscal], inAppLocation('fiscal-calendar'))).toEqual({
      path: '/in-app-skills/fiscal-calendar/SKILL.md',
      content: renderSkillDocument(fiscal),
    });
    expect(
      readInAppPath(
        [fiscal],
        '/in-app-skills/fiscal-calendar/reference/quarters.md',
      ),
    ).toEqual({
      path: '/in-app-skills/fiscal-calendar/reference/quarters.md',
      content: 'Q1 is July to September.',
    });
  });

  it('refuses every other path under /in-app-skills/, and ignores the rest', () => {
    for (const path of [
      '/in-app-skills/other/SKILL.md',
      '/in-app-skills/fiscal-calendar/reference/missing.md',
      '/in-app-skills/fiscal-calendar/scripts/run.js',
      '/in-app-skills/fiscal-calendar/reference/../SKILL.md',
      '/in-app-skills/fiscal-calendar/reference/a/b.md',
      '/in-app-skills/fiscal-calendar',
    ]) {
      expect(readInAppPath([fiscal], path)).toBeNull();
    }
    expect(readInAppPath(undefined, '/in-app-skills/x/SKILL.md')).toBeNull();
    expect(readInAppPath([fiscal], '/skills/curated-knowledge/SKILL.md')).toBe(
      undefined,
    );
  });
});
