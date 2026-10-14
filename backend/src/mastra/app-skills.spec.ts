import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { symlinkSync } from 'fs';
import {
  AGENT_SKILLS,
  AppSkill,
  HARNESS_SKILLS,
  agentSkillFile,
  agentSkillsView,
  appSkillBody,
  appSkillDocument,
  appSkillFile,
  loadAppSkills,
  readSkillFile,
  resolveSkills,
  skillBody,
  skillFiles,
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
    expect(() => validateAgentSkills(skills, HARNESS_SKILLS)).not.toThrow();
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

/** A SKILL.md with the given front-matter lines and body. */
function md(lines: string[], body: string): string {
  return ['---', ...lines, '---', '', body, ''].join('\n');
}

describe('resolveSkills (built-in < user < project)', () => {
  let builtInRoot: string;
  let userRoot: string;
  let projectRoot: string;
  let builtIn: Map<string, AppSkill>;
  let warnings: string[];

  function write(base: string, name: string, files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      const target = join(base, name, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, text);
    }
  }

  function resolve() {
    return resolveSkills(
      builtIn,
      { user: userRoot, project: projectRoot },
      (message) => warnings.push(message),
    );
  }

  const knowledge = (body: string) => ({
    'SKILL.md': md(
      ['name: curated-knowledge', 'description: Use when knowledge applies.'],
      body,
    ),
  });
  const deepAnalysis = (plan: string) => ({
    'SKILL.md': md(
      ['name: deep-analysis', 'description: Use when analysing deeply.'],
      'Phase 1 is phases/1-plan.md.',
    ),
    'phases/1-plan.md': plan,
  });

  beforeEach(() => {
    builtInRoot = join(root, 'built-in');
    userRoot = join(root, 'user');
    projectRoot = join(root, 'project');
    warnings = [];
    write(builtInRoot, 'curated-knowledge', knowledge('Built-in rules.'));
    write(
      builtInRoot,
      'deep-analysis',
      deepAnalysis('Plan {{question}} over {{datasets}}.'),
    );
    builtIn = loadAppSkills(builtInRoot);
  });

  it('keeps the built-ins, with their tables, when no other level exists', () => {
    const { skills, skipped, levels } = resolve();

    expect([...skills.keys()].sort()).toEqual([
      'curated-knowledge',
      'deep-analysis',
    ]);
    expect(skills.get('deep-analysis')).toMatchObject({
      level: 'built-in',
      loading: 'harness',
      agents: ['assistant'],
      overrides: [],
    });
    expect(skipped).toEqual([]);
    expect(levels).toEqual([
      { level: 'built-in', path: null, found: true },
      { level: 'user', path: userRoot, found: false },
      { level: 'project', path: projectRoot, found: false },
    ]);
    expect(warnings).toEqual([
      `[skills] Project skills folder not found: ${projectRoot}`,
    ]);
  });

  it('reports no project level when the variable is not set', () => {
    const { levels } = resolveSkills(builtIn, {
      user: userRoot,
      project: null,
    });
    expect(levels[2]).toEqual({ level: 'project', path: null, found: false });
  });

  it('gives a new user skill to the assistant, on demand', () => {
    write(userRoot, 'sql-style', {
      'SKILL.md': md(
        ['name: sql-style', 'description: Use when writing SQL.'],
        'Rules in reference/style.md.',
      ),
      'reference/style.md': 'One clause per line.',
    });

    const style = resolve().skills.get('sql-style');

    expect(style).toMatchObject({
      level: 'user',
      loading: 'on-demand',
      agents: ['assistant'],
      overrides: [],
      warnings: [],
      dir: join(userRoot, 'sql-style'),
    });
  });

  it('lets project override user override built-in, by name, keeping the loading mode', () => {
    mkdirSync(projectRoot, { recursive: true });
    write(userRoot, 'curated-knowledge', knowledge('User rules.'));
    write(projectRoot, 'curated-knowledge', knowledge('Project rules.'));

    const winner = resolve().skills.get('curated-knowledge')!;

    expect(winner).toMatchObject({
      level: 'project',
      loading: 'harness',
      agents: ['assistant'],
      overrides: ['built-in', 'user'],
    });
    expect(skillBody(winner.document)).toBe('Project rules.');
  });

  it('reads the agents key: a one-line list, and only agents that load skills on demand', () => {
    const named = (name: string, agents: string) => ({
      'SKILL.md': md(
        [
          `name: ${name}`,
          `description: Use when ${name}.`,
          `agents: ${agents}`,
        ],
        'b',
      ),
    });
    write(userRoot, 'listed', named('listed', '[assistant]'));
    write(userRoot, 'designer', named('designer', 'visualization'));
    write(userRoot, 'ghost', named('ghost', '[nope, assistant]'));

    const { skills, skipped } = resolve();

    expect(skills.get('listed')?.agents).toEqual(['assistant']);
    expect(skipped).toEqual([
      {
        name: 'designer',
        level: 'user',
        dir: join(userRoot, 'designer'),
        problems: ['agent "visualization" does not load skills on demand'],
        agents: ['visualization'],
      },
      {
        name: 'ghost',
        level: 'user',
        dir: join(userRoot, 'ghost'),
        problems: ['unknown agent "nope"'],
        agents: ['assistant'],
      },
    ]);
  });

  it('skips a broken user skill, logs it and keeps going', () => {
    write(userRoot, 'broken', {
      'SKILL.md': md(['name: broken'], 'Read reference/gone.md.'),
    });
    write(userRoot, 'renamed', {
      'SKILL.md': md(['name: other', 'description: Use when x.'], 'b'),
    });
    write(userRoot, 'fine', {
      'SKILL.md': md(['name: fine', 'description: Use when fine.'], 'b'),
    });

    const { skills, skipped } = resolve();

    expect(skills.has('fine')).toBe(true);
    expect(skills.has('broken')).toBe(false);
    expect(skipped.map((skill) => [skill.name, skill.problems])).toEqual([
      ['broken', ['description is missing', 'reference/gone.md is missing']],
      ['renamed', ['name "other" does not match its folder']],
    ]);
    expect(warnings).toContain(
      '[skills] Skipped user skill "broken": description is missing; reference/gone.md is missing',
    );
  });

  it('ignores extra front-matter keys and nested maps in user skills', () => {
    write(userRoot, 'standard', {
      'SKILL.md': md(
        [
          'name: standard',
          'description: Use when a standard skill applies.',
          'license: MIT',
          'metadata:',
          '  author: someone',
          '  tags: [a, b]',
        ],
        'b',
      ),
    });

    expect(resolve().skills.get('standard')?.description).toBe(
      'Use when a standard skill applies.',
    );
  });

  it('checks an override of a harness-loaded skill against the built-in files and placeholders', () => {
    mkdirSync(projectRoot, { recursive: true });
    write(userRoot, 'deep-analysis', deepAnalysis('Plan {{question}} only.'));
    write(projectRoot, 'curated-knowledge', knowledge(''));

    const { skills, skipped } = resolve();

    expect(
      skipped.map((skill) => [skill.name, skill.level, skill.problems]),
    ).toEqual([
      [
        'deep-analysis',
        'user',
        [
          'phases/1-plan.md must use the placeholders {{datasets}}, {{question}}',
        ],
      ],
      ['curated-knowledge', 'project', ['the body is empty']],
    ]);
    // A skipped override leaves the level below in place.
    expect(skills.get('deep-analysis')?.level).toBe('built-in');
    expect(skills.get('curated-knowledge')?.level).toBe('built-in');
  });

  it('needs every phase file of the harness-loaded skill it overrides', () => {
    write(userRoot, 'deep-analysis', {
      'SKILL.md': md(
        ['name: deep-analysis', 'description: Use when analysing deeply.'],
        'No phases here.',
      ),
    });

    expect(resolve().skipped[0].problems).toEqual([
      'phases/1-plan.md is missing (the skill it overrides has it)',
    ]);
  });

  it('accepts a matching override and warns about ignored agents and scripts', () => {
    write(userRoot, 'deep-analysis', {
      ...deepAnalysis('Plan {{datasets}} for {{question}}, my way.'),
      'SKILL.md': md(
        [
          'name: deep-analysis',
          'description: Use when analysing deeply.',
          'agents: [assistant]',
        ],
        'Phase 1 is phases/1-plan.md.',
      ),
      'scripts/run.py': 'print(1)',
    });

    const winner = resolve().skills.get('deep-analysis');

    expect(winner).toMatchObject({ level: 'user', overrides: ['built-in'] });
    expect(winner?.warnings).toEqual([
      'agents is ignored on an override',
      'scripts/ is not run for user and project skills',
    ]);
  });

  it('ignores dot-folders and symbolic links to folders', () => {
    write(userRoot, '.hidden', {
      'SKILL.md': md(['name: .hidden', 'description: Use when x.'], 'b'),
    });
    write(root, 'elsewhere', {
      'SKILL.md': md(['name: linked', 'description: Use when x.'], 'b'),
    });
    symlinkSync(join(root, 'elsewhere'), join(userRoot, 'linked'));

    const { skills, skipped } = resolve();

    expect(skills.has('.hidden')).toBe(false);
    expect(skills.has('linked')).toBe(false);
    expect(skipped).toEqual([]);
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

    expect(view.levels.map((level) => level.level)).toEqual([
      'built-in',
      'user',
      'project',
    ]);
    expect(view.skills).toEqual([
      expect.objectContaining({
        name: 'interactive-visuals',
        level: 'built-in',
        loading: 'harness',
        overrides: [],
        files: [
          expect.objectContaining({ path: 'SKILL.md' }),
          expect.objectContaining({ path: 'reference/freeform.md' }),
          expect.objectContaining({ path: 'reference/spec-mode.md' }),
        ],
      }),
    ]);
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
