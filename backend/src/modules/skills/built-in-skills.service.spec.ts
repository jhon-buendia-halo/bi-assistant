import BetterSqlite3 from 'better-sqlite3';
import { AUTH_REQUIREMENT_KEY } from '../../common/decorators/auth-requirement.decorators';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import {
  agentSkillFile,
  agentSkillsView,
  appSkillBody,
  appSkillDocument,
  appSkillFile,
  catalogSkills,
  shippedBuiltIn,
} from '../../mastra/app-skills';
import { setSkillOverrides } from '../../mastra/skill-overrides';
import { assistantSkillSources } from '../../mastra/assistant-skills';
import { CurrentUserService, LOCAL_USER } from '../auth/current-user.service';
import { phasePrompt } from '../deep-analysis/deep-analysis.phases';
import { BuiltInSkillsService } from './built-in-skills.service';
import type { SkillOverrideDoc } from './entities/skill-override.entity';
import { SkillOverridesRepository } from './repositories/skill-overrides.repository';
import { SkillsController } from './skills.controller';

function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<SkillOverrideDoc>(db, 'skill_overrides');
  const users = new CurrentUserService();
  return {
    store,
    service: new BuiltInSkillsService(
      new SkillOverridesRepository(store),
      users,
    ),
    asAdmin: <T>(fn: () => Promise<T>) => users.runAs(LOCAL_USER, fn),
  };
}

const DESCRIPTION = 'Use when a question needs the edited know-how.';

/** A valid save of `name`: the shipped files, each with a marker appended. */
function edited(name: string) {
  const shipped = shippedBuiltIn(name)!;
  return {
    description: DESCRIPTION,
    body: `${shipped.body}\n\nEdited in the app.`,
    files: shipped.files.map((file) => ({
      path: file.path,
      content: `${file.content}\nEdited ${file.path}.`,
    })),
  };
}

afterEach(() => setSkillOverrides([]));

describe('BuiltInSkillsService', () => {
  it('lists the four built-in skills, unmodified, sorted by name', async () => {
    const { service } = build();
    const list = await service.list();
    expect(list.map((skill) => skill.name)).toEqual([
      'curated-knowledge',
      'deep-analysis',
      'interactive-visuals',
      'rfp-process',
    ]);
    expect(list[0]).toMatchObject({
      loading: 'on-demand',
      agents: ['assistant'],
      modified: false,
      builtInChanged: false,
      updatedAt: null,
    });
    expect(list[1]).toMatchObject({ loading: 'harness' });
  });

  it('answers an unknown built-in skill as not found, or as a refusal', async () => {
    const { service } = build();
    await expect(service.get('nope')).rejects.toThrow(
      'Unknown built-in skill "nope"',
    );
    await expect(service.save('nope', edited('deep-analysis'))).rejects.toThrow(
      'Unknown built-in skill "nope"',
    );
    await expect(service.reset('nope')).rejects.toThrow(
      'Unknown built-in skill "nope"',
    );
  });

  it('refuses a save with the first failing check, in the documented order', async () => {
    const { service } = build();
    const ok = edited('deep-analysis');
    const refusal = (patch: object) =>
      service.save('deep-analysis', { ...ok, ...patch }).then(
        () => 'saved',
        (err: Error) => err.message,
      );

    expect(await refusal({ description: 'Nothing here' })).toBe(
      'The description must start with "Use when"',
    );
    expect(await refusal({ description: `Use when ${'x'.repeat(300)}` })).toBe(
      'The description is at most 300 characters',
    );
    expect(await refusal({ body: '  \n' })).toBe('The body is empty');
    expect(await refusal({ body: 'x'.repeat(20_001) })).toBe(
      'The body is at most 20,000 characters',
    );
    expect(
      await refusal({
        files: [...ok.files, { path: 'phases/9.md', content: '' }],
      }),
    ).toBe('phases/9.md is not a file of this skill');
    expect(await refusal({ files: ok.files.slice(1) })).toBe(
      `${ok.files[0].path} is missing (the skill it overrides has it)`,
    );
    expect(
      await refusal({
        files: ok.files.map((file, i) =>
          i === 0 ? { ...file, content: 'x'.repeat(20_001) } : file,
        ),
      }),
    ).toBe(`"${ok.files[0].path}" is at most 20,000 characters`);
    // The first file with the wrong placeholders; the placeholder check
    // runs after the size checks.
    expect(
      await refusal({
        files: ok.files.map((file, i) =>
          i === 0 ? { ...file, content: 'no placeholders' } : file,
        ),
      }),
    ).toMatch(/^phases\/1-plan\.md must use the placeholders \{\{question\}\}/);
    expect(await refusal({ files: 'nope' })).toMatch(/is missing/);
  });

  it('refuses extra files for a skill without any, and files with placeholders added', async () => {
    const { service } = build();
    const base = {
      description: DESCRIPTION,
      body: 'Edited.',
    };
    await expect(
      service.save('curated-knowledge', {
        ...base,
        files: [{ path: 'reference/a.md', content: 'x' }],
      }),
    ).rejects.toThrow('reference/a.md is not a file of this skill');
    const ok = edited('interactive-visuals');
    const plain = ok.files.find((file) => !file.content.includes('{{'));
    expect(plain).toBeDefined();
    await expect(
      service.save('interactive-visuals', {
        ...ok,
        files: ok.files.map((file) =>
          file === plain ? { ...file, content: `${file.content} {{x}}` } : file,
        ),
      }),
    ).rejects.toThrow(`${plain!.path} must use no placeholders`);
  });

  it('leaves everything unchanged when a save is refused', async () => {
    const { service, store } = build();
    const ok = edited('deep-analysis');
    await expect(
      service.save('deep-analysis', {
        ...ok,
        files: ok.files.map((file) => ({
          ...file,
          content: 'no placeholders',
        })),
      }),
    ).rejects.toThrow('must use the placeholders');
    expect(await store.find()).toEqual([]);
    expect(appSkillBody('deep-analysis')).toBe(
      shippedBuiltIn('deep-analysis')!.body,
    );
    expect((await service.list()).every((skill) => !skill.modified)).toBe(true);
  });

  it('serves a saved override on the next call, and keeps the built-in layout', async () => {
    const { service, asAdmin, store } = build();
    const input = edited('deep-analysis');
    const before = catalogSkills('assistant').map((skill) => skill.description);

    const saved = await asAdmin(() => service.save('deep-analysis', input));
    expect(saved).toMatchObject({
      name: 'deep-analysis',
      modified: true,
      builtInChanged: false,
      description: DESCRIPTION,
      body: input.body,
      loading: 'harness',
      agents: ['assistant'],
    });
    expect(saved.builtIn.body).toBe(shippedBuiltIn('deep-analysis')!.body);
    expect(await store.findOne({ name: 'deep-analysis' })).toMatchObject({
      updatedBy: 'local',
      baseHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
    });

    // Harness reads: the body, the document and a phase file are the override's.
    expect(appSkillBody('deep-analysis')).toBe(input.body.trim());
    expect(appSkillDocument('deep-analysis')).toContain(
      `description: ${DESCRIPTION}`,
    );
    expect(appSkillFile('deep-analysis', 'phases/1-plan.md')).toBe(
      input.files[0].content,
    );
    expect(phasePrompt('plan', { question: 'Q?' })).toContain(
      'Edited phases/1-plan.md.',
    );

    // Not an on-demand skill: the assistant catalog is untouched.
    expect(
      catalogSkills('assistant').map((skill) => skill.description),
    ).toEqual(before);
    const view = agentSkillsView('assistant').skills.find(
      (skill) => skill.name === 'deep-analysis',
    );
    expect(view).toMatchObject({
      modified: true,
      level: 'built-in',
      description: DESCRIPTION,
    });
    const plan = view!.files.find((file) => file.path === 'phases/1-plan.md');
    expect(plan!.size).toBe(Buffer.byteLength(input.files[0].content));
    expect(
      agentSkillFile('assistant', 'deep-analysis', 'phases/1-plan.md'),
    ).toMatchObject({ content: input.files[0].content });
    expect(
      agentSkillsView('assistant').skills.find(
        (s) => s.name === 'curated-knowledge',
      ),
    ).not.toHaveProperty('modified');
  });

  it("shows an on-demand override in the assistant's skills", async () => {
    const { service } = build();
    const original = catalogSkills('assistant')[0];
    await service.save('curated-knowledge', {
      description: DESCRIPTION,
      body: 'Edited curated knowledge.',
      files: [],
    });
    const [skill] = catalogSkills('assistant');
    expect(skill).toMatchObject({
      name: 'curated-knowledge',
      description: DESCRIPTION,
      dir: original.dir,
    });
    expect(assistantSkillSources()).toEqual([
      expect.objectContaining({
        name: 'curated-knowledge',
        description: DESCRIPTION,
        body: 'Edited curated knowledge.',
      }),
    ]);
  });

  it('restores the built-in on reset, also when there was no override', async () => {
    const { service, store } = build();
    const shipped = shippedBuiltIn('curated-knowledge')!;
    await service.save('curated-knowledge', {
      description: DESCRIPTION,
      body: 'Edited.',
      files: [],
    });
    await service.reset('curated-knowledge');
    expect(await store.find()).toEqual([]);
    expect(catalogSkills('assistant')[0].description).toBe(shipped.description);
    expect(appSkillBody('curated-knowledge')).toBe(shipped.body);
    await expect(service.reset('curated-knowledge')).resolves.toBeUndefined();
  });

  it('flags builtInChanged when the shipped built-in no longer matches the override', async () => {
    const { service, store } = build();
    await service.save('curated-knowledge', {
      description: DESCRIPTION,
      body: 'Edited.',
      files: [],
    });
    expect((await service.get('curated-knowledge')).builtInChanged).toBe(false);
    await store.update({ name: 'curated-knowledge' }, { baseHash: 'old' });
    const list = await service.list();
    expect(list.find((s) => s.name === 'curated-knowledge')).toMatchObject({
      modified: true,
      builtInChanged: true,
    });
    // Still served until saved again or reset.
    expect(appSkillBody('curated-knowledge')).toBe('Edited.');
  });

  it('ignores an override of a name that is no longer built in', () => {
    setSkillOverrides([
      {
        name: 'gone-skill',
        description: DESCRIPTION,
        body: 'x',
        files: [],
        baseHash: 'h',
      },
    ]);
    expect(catalogSkills('assistant').map((s) => s.name)).toEqual([
      'curated-knowledge',
    ]);
  });

  it('loads the stored overrides on start', async () => {
    const { service, store } = build();
    await store.insert({
      name: 'curated-knowledge',
      description: DESCRIPTION,
      body: 'From the database.',
      files: [],
      baseHash: 'h',
      updatedBy: 'local',
    });
    await service.onModuleInit();
    expect(appSkillBody('curated-knowledge')).toBe('From the database.');
  });
});

describe('SkillsController built-in routes', () => {
  const requirement = (method: keyof SkillsController) =>
    Reflect.getMetadata(
      AUTH_REQUIREMENT_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      SkillsController.prototype[method],
    ) as unknown;

  it('needs use-agents to read and edit-policies to change', () => {
    const need = (permission: string) => ({ kind: 'permission', permission });
    expect(requirement('listBuiltIn')).toEqual(need('use-agents'));
    expect(requirement('getBuiltIn')).toEqual(need('use-agents'));
    expect(requirement('saveBuiltIn')).toEqual(need('edit-policies'));
    expect(requirement('resetBuiltIn')).toEqual(need('edit-policies'));
  });

  it('declares the built-in routes before /skills/:id', () => {
    const order = Object.getOwnPropertyNames(SkillsController.prototype);
    expect(order.indexOf('getBuiltIn')).toBeLessThan(order.indexOf('get'));
    expect(order.indexOf('listBuiltIn')).toBeLessThan(order.indexOf('get'));
  });

  it('answers Style A: a refusal comes back as ok:false', async () => {
    const { service } = build();
    const controller = new SkillsController({} as never, service);
    const refused = await controller.saveBuiltIn('deep-analysis', {});
    expect(refused).toEqual({
      ok: false,
      message: 'The description must start with "Use when"',
    });
    const reset = await controller.resetBuiltIn('curated-knowledge');
    expect(reset).toEqual({
      ok: true,
      message: 'Built-in skill "curated-knowledge" reset',
    });
    const unknown = await controller.resetBuiltIn('nope');
    expect(unknown.ok).toBe(false);
  });
});
