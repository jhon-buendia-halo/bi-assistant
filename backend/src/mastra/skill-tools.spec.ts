import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AppSkill } from './app-skills';
import {
  readSkillPath,
  resolveScript,
  runSkillScript,
  skillScripts,
  skillToolsFor,
} from './skill-tools';

let root: string;

function skill(name: string, files: Record<string, string>): AppSkill {
  const dir = join(root, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return {
    name,
    description: `Use when ${name}.`,
    dir,
    document: files['SKILL.md'] ?? '',
    loading: 'on-demand',
    agents: ['assistant'],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-tools-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('read_file', () => {
  it('reads a listed skill file by its absolute path', () => {
    const style = skill('sql-style', {
      'SKILL.md': 'body',
      'reference/style.md': 'One clause per line.',
    });

    expect(readSkillPath([style], join(style.dir, 'SKILL.md'))).toEqual({
      path: join(style.dir, 'SKILL.md'),
      content: 'body',
    });
    expect(
      readSkillPath(
        [style],
        join(style.dir, 'phases', '..', 'reference', 'style.md'),
      ),
    ).toMatchObject({ content: 'One clause per line.' });
  });

  it('refuses relative paths, paths outside the skills and symbolic links', () => {
    const style = skill('sql-style', { 'SKILL.md': 'body' });
    writeFileSync(join(root, 'secret.txt'), 'secret');
    symlinkSync(join(root, 'secret.txt'), join(style.dir, 'leak.txt'));
    const refused = expect.objectContaining({
      error: expect.stringMatching(
        /^Not a file of an installed skill: /,
      ) as string,
    }) as unknown;

    for (const path of [
      'SKILL.md',
      join(root, 'secret.txt'),
      join(style.dir, '..', 'secret.txt'),
      join(style.dir, 'leak.txt'),
      join(style.dir, 'missing.md'),
      style.dir,
      '',
    ]) {
      expect(readSkillPath([style], path)).toEqual(refused);
    }
  });

  it('says why a binary or very large file cannot be read', () => {
    const style = skill('sql-style', { 'SKILL.md': 'body' });
    writeFileSync(join(style.dir, 'blob.bin'), Buffer.from([1, 0, 2]));

    expect(readSkillPath([style], join(style.dir, 'blob.bin'))).toEqual({
      path: join(style.dir, 'blob.bin'),
      error:
        "This file is larger than 256 KB or isn't text, so it can't be read.",
    });
  });
});

describe('run_skill_script', () => {
  it('lists only a skill’s Node scripts under scripts/', () => {
    const files = {
      'SKILL.md': 'b',
      'scripts/check.js': '',
      'scripts/lib/util.mjs': '',
      'scripts/run.py': '',
      'check.js': '',
    };
    expect(skillScripts(skill('tool', files))).toEqual([
      'scripts/check.js',
      'scripts/lib/util.mjs',
    ]);
  });

  it('refuses an unknown skill or a file that is not a script', () => {
    const tool = skill('tool', { 'SKILL.md': 'b', 'scripts/check.js': '' });

    expect(resolveScript([tool], 'nope', 'scripts/check.js')).toEqual({
      error: 'Unknown skill: nope',
    });
    expect(resolveScript([tool], 'tool', '../tool/SKILL.md')).toEqual({
      error: 'Not a script of tool: ../tool/SKILL.md',
    });
    expect(resolveScript([tool], 'tool', 'scripts/check.js')).toMatchObject({
      script: 'scripts/check.js',
    });
  });

  it('runs with arguments and no shell, in the skill folder, without app secrets', async () => {
    const tool = skill('tool', {
      'SKILL.md': 'b',
      'scripts/echo.js': [
        'console.log(JSON.stringify({',
        '  args: process.argv.slice(2),',
        '  cwd: process.cwd(),',
        '  secret: process.env.APP_SECRET ?? null,',
        '}));',
        'console.error("warned");',
        'process.exit(3);',
      ].join('\n'),
    });
    process.env.APP_SECRET = 'do-not-leak';
    try {
      const result = await runSkillScript(tool, 'scripts/echo.js', [
        'a b',
        '$(touch pwned)',
        ';ls',
      ]);
      expect(result.exitCode).toBe(3);
      expect(result.stderr.trim()).toBe('warned');
      expect(JSON.parse(result.stdout)).toEqual({
        args: ['a b', '$(touch pwned)', ';ls'],
        cwd: tool.dir,
        secret: null,
      });
    } finally {
      delete process.env.APP_SECRET;
    }
  });

  it('kills a script that runs past the timeout, and caps long output', async () => {
    const tool = skill('tool', {
      'SKILL.md': 'b',
      'scripts/hang.js':
        'process.stdout.write("x".repeat(30000)); setInterval(() => {}, 1000);',
    });

    const result = await runSkillScript(tool, 'scripts/hang.js', [], 1500);

    expect(result).toMatchObject({ exitCode: null, timedOut: true });
    expect(result.stdout.endsWith('…[truncated]')).toBe(true);
    expect(result.stdout.length).toBe(20000 + '…[truncated]'.length);
  });
});

describe('skillToolsFor', () => {
  it('offers nothing without skills, read_file for text skills, and run_skill_script only with a script', () => {
    const text = skill('text', { 'SKILL.md': 'b' });
    const withScript = skill('tool', {
      'SKILL.md': 'b',
      'scripts/check.js': '',
    });

    expect(Object.keys(skillToolsFor('assistant', []))).toEqual([]);
    expect(Object.keys(skillToolsFor('assistant', [text]))).toEqual([
      'read_file',
    ]);
    expect(Object.keys(skillToolsFor('assistant', [text, withScript]))).toEqual(
      ['read_file', 'run_skill_script'],
    );
  });
});
