import { appSkillBody } from './app-skills';
import { knowledgeContext } from './context-blocks';

const BLOCK =
  'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):\n- [term] Host: the country that staged the tournament.';

describe('knowledgeContext (agents.md 4.1 Block 3, 7.4)', () => {
  it('sends the block, then the curated-knowledge skill', () => {
    expect(knowledgeContext(BLOCK)).toEqual([
      { role: 'system', content: BLOCK },
      { role: 'system', content: appSkillBody('curated-knowledge') },
    ]);
  });

  it('sends nothing when no knowledge applies', () => {
    expect(knowledgeContext(undefined)).toEqual([]);
    expect(knowledgeContext('')).toEqual([]);
    expect(knowledgeContext('  \n ')).toEqual([]);
  });

  it("sends the skill's rules, not its front matter", () => {
    const [, skill] = knowledgeContext(BLOCK);
    expect(skill.content.startsWith('Curated knowledge:\n')).toBe(true);
    expect(skill.content).toContain(
      'Apply every [default_filter] to every query you run',
    );
    expect(skill.content).not.toContain('name: curated-knowledge');
  });
});
