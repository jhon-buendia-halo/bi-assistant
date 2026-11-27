import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentSkill } from './agent-skills';
import * as appSkillsModule from './app-skills';
import type { AppSkill } from './app-skills';
import { frameworkSkills, skillSourcesFor } from './agent-skill-sources';

describe('the skills of a call with user folder skills (ADR-0025)', () => {
  let dir: string;
  let folderSkill: AppSkill;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-skill-sources-'));
    mkdirSync(join(dir, 'reference'));
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\nname: sql-style\ndescription: Use when writing SQL.\n---\n\nFollow reference/rules.md and [[tool:run_readonly_sql]].\n',
    );
    writeFileSync(join(dir, 'reference', 'rules.md'), 'Use [[skill:other]].');
    writeFileSync(join(dir, 'scripts', 'run.js'), 'console.log(1)');
    writeFileSync(join(dir, 'logo.bin'), Buffer.from([0, 1, 2]));
    folderSkill = {
      name: 'sql-style',
      description: 'Use when writing SQL.',
      dir,
      document: `---\nname: sql-style\ndescription: Use when writing SQL.\n---\n\nFollow reference/rules.md and [[tool:run_readonly_sql]].\n`,
      loading: 'on-demand',
      agents: ['assistant'],
    };
    jest.spyOn(appSkillsModule, 'catalogSkills').mockReturnValue([folderSkill]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives a folder skill its body and its text files as references, without scripts or binaries', () => {
    expect(appSkillsModule.skillReferences(folderSkill)).toEqual({
      'reference/rules.md': 'Use [[skill:other]].',
    });
    const [skill] = frameworkSkills(skillSourcesFor('assistant'));
    expect(skill.name).toBe('sql-style');
    expect(skill.instructions).toBe(
      'Follow references/rules.md and the "run_readonly_sql" tool.',
    );
    expect(skill.references).toEqual(['rules.md']);
    expect(skill.__referenceContents['rules.md']).toBe(
      'Use the "other" skill.',
    );
  });

  it('replaces the folder skill with the agent skill of the same name', () => {
    const own: AgentSkill = {
      id: 'x',
      name: 'sql-style',
      description: 'Use when the agent says so.',
      body: 'Agent body.',
      files: [],
    };
    const sources = skillSourcesFor('assistant', [own]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      description: 'Use when the agent says so.',
      body: 'Agent body.',
      files: {},
    });
  });

  it('puts the agent skills after the catalogue skills, in their order', () => {
    const skill = (name: string): AgentSkill => ({
      id: name,
      name,
      description: `Use for ${name}.`,
      body: `${name} body.`,
      files: [],
    });
    expect(
      skillSourcesFor('insights-lead', [skill('zeta'), skill('alpha')]).map(
        (source) => source.name,
      ),
    ).toEqual(['sql-style', 'zeta', 'alpha']);
  });
});
