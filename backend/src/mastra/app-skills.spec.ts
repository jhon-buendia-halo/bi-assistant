import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AGENT_SKILLS,
  appSkillBody,
  appSkillDocument,
  appSkillFile,
  loadAppSkills,
  skillBody,
  skillPathsFor,
  skillsRoot,
  validateAgentSkills,
} from './app-skills';

const VALID = [
  '---',
  'name: demo',
  'description: Use when a demo needs a skill.',
  '---',
  '',
  'Read phases/1-intake.md first, then references/style.md.',
].join('\n');

let root: string;

function skill(name: string, text: string, files: Record<string, string> = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), text);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

function problems(): string {
  try {
    loadAppSkills(root);
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'app-skills-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadAppSkills', () => {
  it('loads a valid skill with its linked files', () => {
    skill('demo', VALID, {
      'phases/1-intake.md': 'intake',
      'references/style.md': 'style',
    });

    const skills = loadAppSkills(root);

    expect([...skills.keys()]).toEqual(['demo']);
    const demo = skills.get('demo')!;
    expect(demo.description).toBe('Use when a demo needs a skill.');
    expect(demo.dir).toBe(join(root, 'demo'));
    expect(demo.document).toBe(VALID);
  });

  it('fails when the skills folder is missing', () => {
    expect(() => loadAppSkills(join(root, 'nope'))).toThrow(
      /Invalid app skills:\n.*skills folder not found/,
    );
  });

  it('fails when a folder has no SKILL.md', () => {
    mkdirSync(join(root, 'empty'));
    expect(problems()).toContain('empty: SKILL.md is missing');
  });

  it('fails without front matter', () => {
    skill('bare', 'Just text.');
    expect(problems()).toContain('bare: front matter is missing');
  });

  it('fails without a name or a description', () => {
    skill(
      'anon',
      ['---', 'description: Use when x.', '---', 'body'].join('\n'),
    );
    skill('mute', ['---', 'name: mute', '---', 'body'].join('\n'));

    const message = problems();
    expect(message).toContain('anon: name is missing');
    expect(message).toContain('mute: description is missing');
  });

  it('fails when the name differs from the folder', () => {
    skill('folder', VALID);
    expect(problems()).toContain(
      'folder: name "demo" does not match its folder',
    );
  });

  it('fails when the description does not start with "Use when"', () => {
    skill(
      'vague',
      VALID.replace('name: demo', 'name: vague').replace(
        'Use when a demo needs',
        'A demo with',
      ),
    );
    expect(problems()).toContain(
      'vague: description must start with "Use when"',
    );
  });

  it('fails on a multi-line or unknown front-matter key', () => {
    skill(
      'folded',
      [
        '---',
        'name: folded',
        'description: >',
        '  Use when folded.',
        '---',
        'b',
      ].join('\n'),
    );
    skill(
      'extra',
      [
        '---',
        'name: extra',
        'description: Use when x.',
        'license: MIT',
        '---',
        'b',
      ].join('\n'),
    );

    const message = problems();
    expect(message).toContain('folded: description must be on one line');
    expect(message).toContain('extra: unknown front-matter key "license"');
  });

  it('fails when the body names a phase or reference that does not exist', () => {
    skill('demo', VALID, { 'phases/1-intake.md': 'intake' });
    expect(problems()).toContain('demo: references/style.md is missing');
  });

  it('reports every problem at once, one line each', () => {
    skill('a', 'no front matter');
    skill('b', 'none either');
    expect(problems().split('\n').slice(1)).toEqual([
      'a: front matter is missing',
      'b: front matter is missing',
    ]);
  });
});

describe('skillBody', () => {
  it('drops the front matter and the blank lines around the body', () => {
    expect(skillBody(`${VALID}\n\n`)).toBe(
      'Read phases/1-intake.md first, then references/style.md.',
    );
  });

  it('keeps the body text exactly, line breaks included', () => {
    const body = 'Rules:\n- one\n  continued — "quoted"\n- two';
    expect(
      skillBody(
        [
          '---',
          'name: x',
          'description: Use when x.',
          '---',
          '',
          body,
          '',
        ].join('\n'),
      ),
    ).toBe(body);
  });
});

describe('validateAgentSkills', () => {
  it('fails on a skill an agent declares that does not exist', () => {
    skill('demo', VALID, {
      'phases/1-intake.md': 'intake',
      'references/style.md': 'style',
    });
    const skills = loadAppSkills(root);

    expect(() =>
      validateAgentSkills(skills, { assistant: ['demo'] }),
    ).not.toThrow();
    expect(() => validateAgentSkills(skills, { assistant: ['ghost'] })).toThrow(
      'Unknown skill "ghost" declared for agent "assistant"',
    );
  });
});

describe('the bundled skills', () => {
  it('resolve and validate, with every declared skill present', () => {
    const skills = loadAppSkills(skillsRoot());
    expect(skills.has('interactive-visuals')).toBe(true);
    expect(() => validateAgentSkills(skills, AGENT_SKILLS)).not.toThrow();
  });

  it('serve a skill document and its folder path', () => {
    expect(appSkillDocument('interactive-visuals')).toMatch(
      /^---\nname: interactive-visuals\ndescription: Use when /,
    );
    expect(skillPathsFor('assistant')).toEqual(
      (AGENT_SKILLS.assistant ?? []).map((name) => join(skillsRoot(), name)),
    );
    expect(skillPathsFor('sql-fixer')).toEqual([]);
  });

  it('serve the curated-knowledge rules as a harness-loaded body', () => {
    const skill = loadAppSkills(skillsRoot()).get('curated-knowledge');
    expect(skill?.description).toMatch(/^Use when the turn carries a curated/);
    const body = appSkillBody('curated-knowledge');
    expect(body.startsWith('Curated knowledge:\n')).toBe(true);
    expect(
      body.endsWith('never assume a snippet exists that you cannot see.'),
    ).toBe(true);
    expect(body).not.toContain('---');
    // Harness-loaded only: no agent's catalog lists it.
    for (const names of Object.values(AGENT_SKILLS)) {
      expect(names).not.toContain('curated-knowledge');
    }
  });

  it('refuse a file path outside the skill folder', () => {
    expect(() => appSkillFile('interactive-visuals', '../../index.ts')).toThrow(
      'Invalid skill file path "../../index.ts"',
    );
  });
});
