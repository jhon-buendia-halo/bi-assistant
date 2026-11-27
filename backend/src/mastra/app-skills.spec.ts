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
  linkedFilePaths,
  skillReferences,
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
    expect(skills.has('avery-playbooks')).toBe(true);
    // The designer's skill went with it (ADR-0059).
    expect(skills.has('interactive-visuals')).toBe(false);
    expect(HARNESS_SKILLS).toEqual({});
    expect(() => validateAgentSkills(skills, AGENT_SKILLS)).not.toThrow();
    expect(() => validateAgentSkills(skills, HARNESS_SKILLS)).not.toThrow();
  });

  it('serve a skill document and its folder path', () => {
    expect(appSkillDocument('avery-playbooks')).toMatch(
      /^---\nname: avery-playbooks\ndescription: Use when /,
    );
    // The removed assistant has no catalogue any more (ADR-0059).
    expect(AGENT_SKILLS).not.toHaveProperty('assistant');
    expect(catalogSkills('assistant')).toEqual([]);
    expect(catalogSkills('sql-fixer')).toEqual([]);
  });

  it("serve the curated-knowledge rules as an on-demand skill of Michael's and Elena's", () => {
    const skill = loadAppSkills(skillsRoot()).get('curated-knowledge');
    expect(skill?.description).toMatch(/^Use when the turn carries a curated/);
    const body = appSkillBody('curated-knowledge');
    expect(body.startsWith('Curated knowledge:\n')).toBe(true);
    expect(
      body.endsWith('never assume a snippet exists that you cannot see.'),
    ).toBe(true);
    expect(body).not.toContain('---');
    // The dataset ontology's relation lines (ADR-0036).
    expect(body.replace(/\s+/g, ' ')).toContain(
      '- [relation] lines state how concepts connect (is-a, part-of, has-many, related-to, or measured-by a governed metric); use them to choose joins and the governed metric, never as rows of data.',
    );
    // On demand: their catalogues list it, and no code sends it.
    expect(AGENT_SKILLS['insights-analyst']).toContain('curated-knowledge');
    expect(AGENT_SKILLS['insights-lead']).toContain('curated-knowledge');
    for (const names of Object.values(HARNESS_SKILLS)) {
      expect(names).not.toContain('curated-knowledge');
    }
  });

  it("serve Elena's answer-playbooks and dashboard-building on demand, every reference resolved (plan Elena 2.1)", () => {
    const skills = catalogSkills('insights-lead');
    expect(skills.map((skill) => skill.name)).toEqual([
      'answer-playbooks',
      'conversation-export',
      'curated-knowledge',
      'dashboard-building',
      'result-validation',
      'sql-analysis',
    ]);
    const playbooks = skills.find((s) => s.name === 'answer-playbooks')!;
    const dashboard = skills.find((s) => s.name === 'dashboard-building')!;
    expect(playbooks.description).toBe(
      'Use when a question ranks, compares periods, can be read two ways, returns no rows, or a check fails — which playbook to follow and what the answer must say.',
    );
    expect(dashboard.description).toBe(
      "Use when the user asks for a dashboard or a change to the conversation's dashboard.",
    );
    for (const skill of [playbooks, dashboard]) {
      expect(skill.loading).toBe('on-demand');
      expect(skill.agents).toEqual(['insights-lead']);
    }
    expect(Object.keys(skillReferences(playbooks)).sort()).toEqual([
      'reference/ambiguous.md',
      'reference/failed-check.md',
      'reference/no-answer.md',
      'reference/period-change.md',
      'reference/ranking.md',
    ]);
    expect(Object.keys(skillReferences(dashboard))).toEqual([
      'reference/blueprint.md',
    ]);
    // Every reference the router names is a file of the skill.
    for (const skill of [playbooks, dashboard]) {
      const body = appSkillBody(skill.name);
      const named = linkedFilePaths(body);
      expect(named.length).toBeGreaterThan(0);
      expect(named.every((path) => path in skillReferences(skill))).toBe(true);
    }
    // Written for one agent: no team, no briefs.
    for (const skill of [playbooks, dashboard]) {
      const text = [
        appSkillBody(skill.name),
        ...Object.values(skillReferences(skill)),
      ].join('\n');
      expect(text).not.toMatch(/\b(Avery|Michael|Clara|briefs?)\b/i);
    }
    // Their sizes stay small (plan Elena 3, U2).
    expect(appSkillDocument('answer-playbooks').length).toBeLessThanOrEqual(
      2500,
    );
    expect(appSkillDocument('dashboard-building').length).toBeLessThanOrEqual(
      3000,
    );
    // Avery's skills are unchanged.
    expect(AGENT_SKILLS['chief-of-staff']).toEqual([
      'avery-playbooks',
      'conversation-export',
    ]);
  });

  it('serve a skill body without its front matter', () => {
    const document = appSkillDocument('avery-playbooks');
    const body = appSkillBody('avery-playbooks');

    expect(body.startsWith("# Avery's playbooks\n")).toBe(true);
    expect(body).not.toContain('name: avery-playbooks');
    // Trimmed at both ends (appSkillBody), so compare against the trimmed file.
    expect(document.trimEnd().endsWith(body)).toBe(true);
    expect(document.trimEnd().slice(0, -body.length)).toMatch(
      /^---\nname: avery-playbooks\ndescription: Use when [^\n]*\n---\n+$/,
    );
  });

  it("serve avery-playbooks' references the router names", () => {
    const body = appSkillBody('avery-playbooks');
    for (const reference of ['reference/ranking.md', 'reference/export.md']) {
      expect(body).toContain(reference);
    }
    expect(appSkillFile('avery-playbooks', 'reference/ranking.md')).toMatch(
      /^# Ranking\n/,
    );
  });

  it('refuse a file path outside the skill folder', () => {
    expect(() => appSkillFile('avery-playbooks', '../../index.ts')).toThrow(
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
    // Shared by Insights Analyst and Elena (agents.md 7.4).
    expect(skills.get('curated-knowledge')).toMatchObject({
      loading: 'on-demand',
      agents: ['insights-analyst', 'insights-lead'],
    });
    for (const name of ['sql-analysis', 'result-validation']) {
      expect(skills.get(name)).toMatchObject({
        loading: 'on-demand',
        agents: ['insights-analyst', 'insights-lead'],
      });
    }
    expect(skills.get('conversation-export')).toMatchObject({
      loading: 'on-demand',
      agents: ['chief-of-staff', 'insights-lead'],
    });
    expect(Object.keys(skills.get('avery-playbooks')!).sort()).toEqual([
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
          'answer-playbooks',
          'avery-playbooks',
          'conversation-export',
          'curated-knowledge',
          'dashboard-building',
          'readiness-ai-fitness',
          'readiness-freshness-reliability',
          'readiness-gap-remediation',
          'readiness-governance-privacy',
          'readiness-quality-profiling',
          'readiness-reporting',
          'readiness-scoping',
          'readiness-scoring',
          'readiness-semantics-documentation',
          'readiness-source-inventory',
          'result-validation',
          'sql-analysis',
        ]);
        expect(
          fresh.catalogSkills('insights-analyst').map((skill) => skill.name),
        ).toEqual(['curated-knowledge', 'result-validation', 'sql-analysis']);
        const [playbooks] = fresh.catalogSkills('chief-of-staff');
        expect(playbooks.name).toBe('avery-playbooks');
        expect(Object.keys(fresh.skillReferences(playbooks)).sort()).toEqual([
          'reference/ambiguous.md',
          'reference/dashboard.md',
          'reference/export.md',
          'reference/failed-check.md',
          'reference/no-answer.md',
          'reference/period-change.md',
          'reference/ranking.md',
        ]);
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
  it('shows Avery her avery-playbooks skill with every file', () => {
    const view = agentSkillsView('chief-of-staff');

    expect(
      view.skills.find((skill) => skill.name === 'avery-playbooks'),
    ).toEqual({
      name: 'avery-playbooks',
      description: expect.stringMatching(/^Use when /) as string,
      level: 'built-in',
      loading: 'on-demand',
      files: [
        expect.objectContaining({ path: 'SKILL.md' }),
        expect.objectContaining({ path: 'reference/ambiguous.md' }),
        expect.objectContaining({ path: 'reference/dashboard.md' }),
        expect.objectContaining({ path: 'reference/export.md' }),
        expect.objectContaining({ path: 'reference/failed-check.md' }),
        expect.objectContaining({ path: 'reference/no-answer.md' }),
        expect.objectContaining({ path: 'reference/period-change.md' }),
        expect.objectContaining({ path: 'reference/ranking.md' }),
      ],
    });
    expect(agentSkillsView('sql-fixer').skills).toEqual([]);
  });

  it('serves a skill file only to an agent that has the skill', () => {
    expect(
      agentSkillFile(
        'chief-of-staff',
        'avery-playbooks',
        'reference/ranking.md',
      ),
    ).toMatchObject({
      content: expect.stringMatching(/^# Ranking\n/) as string,
    });
    expect(
      agentSkillFile('insights-lead', 'avery-playbooks', 'SKILL.md'),
    ).toEqual({ error: 'no-skill' });
  });
});
