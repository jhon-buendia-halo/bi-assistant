import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { symlinkSync } from 'fs';
import {
  AGENT_SKILLS,
  HARNESS_SKILLS,
  agentSkillFile,
  agentSkillsView,
  appSkillBody,
  appSkillDocument,
  appSkillFile,
  loadAppSkills,
  readSkillFile,
  skillBody,
  skillFiles,
  catalogSkills,
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

  it('fails on a multi-line name or an unknown front-matter key', () => {
    skill(
      'folded',
      [
        '---',
        'name: >',
        '  folded',
        'description: Use when x.',
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
    expect(message).toContain('folded: name must be on one line');
    expect(message).toContain('extra: unknown front-matter key "license"');
  });

  it('joins a description that wraps onto indented lines or uses a block', () => {
    const wrapped = (name: string, lines: string[]) =>
      skill(name, ['---', `name: ${name}`, ...lines, '---', 'b'].join('\n'));
    // The user's own example (2026-10-14): a plain scalar on two lines.
    wrapped('plain', [
      'description: Use when converting a legacy data flow to a new pipeline, or reviewing',
      '  such a conversion. Covers intake, mapping plan, and verification.',
    ]);
    wrapped('folded', [
      'description: >-',
      '  Use when folded',
      '  over lines.',
    ]);
    wrapped('literal', ['description: |', '  Use when literal.']);

    const skills = loadAppSkills(root);

    expect(skills.get('plain')?.description).toBe(
      'Use when converting a legacy data flow to a new pipeline, or reviewing such a conversion. Covers intake, mapping plan, and verification.',
    );
    expect(skills.get('folded')?.description).toBe(
      'Use when folded over lines.',
    );
    expect(skills.get('literal')?.description).toBe('Use when literal.');
  });

  it('treats an empty description as missing', () => {
    skill(
      'blank',
      ['---', 'name: blank', 'description: >', '---', 'b'].join('\n'),
    );
    expect(problems()).toContain('blank: description is missing');
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
    expect(() => validateAgentSkills(skills, HARNESS_SKILLS)).not.toThrow();
  });

  it('serve a skill document and its folder path', () => {
    expect(appSkillDocument('interactive-visuals')).toMatch(
      /^---\nname: interactive-visuals\ndescription: Use when /,
    );
    // curated-knowledge is the only on-demand skill (ADR-0020).
    expect(AGENT_SKILLS.assistant).toEqual(['curated-knowledge']);
    expect(catalogSkills('assistant').map((skill) => skill.name)).toEqual([
      'curated-knowledge',
    ]);
    expect(catalogSkills('sql-fixer')).toEqual([]);
  });

  it('serve the curated-knowledge rules as an on-demand skill of the assistant', () => {
    const skill = loadAppSkills(skillsRoot()).get('curated-knowledge');
    expect(skill?.description).toMatch(/^Use when the turn carries a curated/);
    const body = appSkillBody('curated-knowledge');
    expect(body.startsWith('Curated knowledge:\n')).toBe(true);
    expect(
      body.endsWith('never assume a snippet exists that you cannot see.'),
    ).toBe(true);
    expect(body).not.toContain('---');
    // On demand: the assistant's catalog lists it, and no code sends it.
    expect(AGENT_SKILLS.assistant).toContain('curated-knowledge');
    for (const names of Object.values(HARNESS_SKILLS)) {
      expect(names).not.toContain('curated-knowledge');
    }
  });

  it('serve a skill body without its front matter', () => {
    const document = appSkillDocument('interactive-visuals');
    const body = appSkillBody('interactive-visuals');

    expect(body.startsWith('# Interactive Visuals\n')).toBe(true);
    expect(body).not.toContain('name: interactive-visuals');
    // Trimmed at both ends (appSkillBody), so compare against the trimmed file.
    expect(document.trimEnd().endsWith(body)).toBe(true);
    expect(document.trimEnd().slice(0, -body.length)).toMatch(
      /^---\nname: interactive-visuals\ndescription: Use when [^\n]*\n---\n+$/,
    );
  });

  it('serve the interactive-visuals references the router names', () => {
    const body = appSkillBody('interactive-visuals');
    for (const reference of [
      'reference/spec-mode.md',
      'reference/freeform.md',
    ]) {
      expect(body).toContain(reference);
    }
    expect(
      appSkillFile('interactive-visuals', 'reference/spec-mode.md'),
    ).toMatch(/^## The spec\n/);
    expect(
      appSkillFile('interactive-visuals', 'reference/freeform.md'),
    ).toMatch(/^## Fallback: freeform HTML\/CSS\/JavaScript\n/);
  });

  it('refuse a file path outside the skill folder', () => {
    expect(() => appSkillFile('interactive-visuals', '../../index.ts')).toThrow(
      'Invalid skill file path "../../index.ts"',
    );
  });
});

describe('skill folders', () => {
  it('ignores dot-folders and symbolic links to folders', () => {
    const builtInRoot = join(root, 'built-in');
    mkdirSync(builtInRoot);
    const write = (base: string, name: string) => {
      mkdirSync(join(base, name), { recursive: true });
      writeFileSync(
        join(base, name, 'SKILL.md'),
        ['---', `name: ${name}`, 'description: Use when x.', '---', 'b'].join(
          '\n',
        ),
      );
    };
    write(builtInRoot, 'kept');
    write(builtInRoot, '.hidden');
    write(root, 'linked');
    symlinkSync(join(root, 'linked'), join(builtInRoot, 'linked'));

    expect([...loadAppSkills(builtInRoot).keys()]).toEqual(['kept']);
  });

  it('takes agents and loading mode from the two tables only', () => {
    const skills = loadAppSkills(skillsRoot());
    expect(skills.get('curated-knowledge')).toMatchObject({
      loading: 'on-demand',
      agents: ['assistant'],
    });
    expect(skills.get('deep-analysis')).toMatchObject({
      loading: 'harness',
      agents: ['assistant'],
    });
    expect(Object.keys(skills.get('deep-analysis')!).sort()).toEqual([
      'agents',
      'description',
      'dir',
      'document',
      'loading',
      'name',
    ]);
  });

  it('ignores a skills folder in the data dir', () => {
    const dataDir = join(root, 'data');
    const own = join(dataDir, 'skills', 'sql-style');
    mkdirSync(own, { recursive: true });
    writeFileSync(
      join(own, 'SKILL.md'),
      ['---', 'name: sql-style', 'description: Use when SQL.', '---', 'b'].join(
        '\n',
      ),
    );
    const saved = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = dataDir;
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fresh = require('./app-skills') as typeof import('./app-skills');
        expect([...fresh.appSkills().keys()].sort()).toEqual([
          'curated-knowledge',
          'deep-analysis',
          'interactive-visuals',
        ]);
        expect(
          fresh.catalogSkills('assistant').map((skill) => skill.name),
        ).toEqual(['curated-knowledge']);
      });
    } finally {
      if (saved === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = saved;
    }
  });
});

describe('skill files', () => {
  it('lists regular files, SKILL.md first, and skips symbolic links', () => {
    const dir = join(root, 'demo');
    skill('demo', VALID, {
      'reference/b.md': 'b',
      'phases/1-intake.md': 'intake',
      'assets/logo.bin': 'x',
    });
    writeFileSync(join(root, 'secret.txt'), 'secret');
    symlinkSync(join(root, 'secret.txt'), join(dir, 'leak.txt'));

    expect(skillFiles(dir).map((file) => file.path)).toEqual([
      'SKILL.md',
      'assets/logo.bin',
      'phases/1-intake.md',
      'reference/b.md',
    ]);
    expect(readSkillFile(dir, 'leak.txt')).toEqual({ error: 'no-file' });
  });

  it('reads a listed file, and holds back binary or very large files', () => {
    const dir = join(root, 'demo');
    skill('demo', VALID, { 'notes.md': 'hello' });
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([65, 0, 66]));
    writeFileSync(join(dir, 'big.md'), 'a'.repeat(256 * 1024 + 1));

    expect(readSkillFile(dir, 'notes.md')).toEqual({
      path: 'notes.md',
      size: 5,
      content: 'hello',
    });
    expect(readSkillFile(dir, 'blob.bin')).toMatchObject({ content: null });
    expect(readSkillFile(dir, 'big.md')).toMatchObject({ content: null });
    expect(readSkillFile(dir, '../secret.txt')).toEqual({
      error: 'invalid-path',
    });
    expect(readSkillFile(dir, '/etc/passwd')).toEqual({
      error: 'invalid-path',
    });
    expect(readSkillFile(dir, '')).toEqual({ error: 'invalid-path' });
    expect(readSkillFile(dir, 'nope.md')).toEqual({ error: 'no-file' });
  });
});

describe('agent skills view (bundled)', () => {
  it('shows the designer its interactive-visuals skill with every file', () => {
    const view = agentSkillsView('visualization');

    expect(view).toEqual({
      skills: [
        {
          name: 'interactive-visuals',
          description: expect.stringMatching(/^Use when /) as string,
          loading: 'harness',
          files: [
            expect.objectContaining({ path: 'SKILL.md' }),
            expect.objectContaining({ path: 'reference/freeform.md' }),
            expect.objectContaining({ path: 'reference/spec-mode.md' }),
          ],
        },
      ],
    });
    expect(agentSkillsView('sql-fixer').skills).toEqual([]);
  });

  it('serves a skill file only to an agent that has the skill', () => {
    expect(
      agentSkillFile(
        'visualization',
        'interactive-visuals',
        'reference/spec-mode.md',
      ),
    ).toMatchObject({
      content: expect.stringMatching(/^## The spec\n/) as string,
    });
    expect(
      agentSkillFile('assistant', 'interactive-visuals', 'SKILL.md'),
    ).toEqual({ error: 'no-skill' });
  });
});
