import BetterSqlite3 from 'better-sqlite3';
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
import { skillSourcesFor } from '../../mastra/agent-skill-sources';
import { validateOverride } from './built-in-skill-rules';
import { BuiltInSkillsService } from './built-in-skills.service';
import type { SkillOverrideDoc } from './entities/skill-override.entity';
import { SkillOverridesRepository } from './repositories/skill-overrides.repository';
import { SkillsController } from './skills.controller';

function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<SkillOverrideDoc>(db, 'skill_overrides');
  return {
    store,
    service: new BuiltInSkillsService(new SkillOverridesRepository(store)),
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
  it('lists the built-in skills, unmodified, sorted by name', async () => {
    const { service } = build();
    const list = await service.list();
    expect(list.map((skill) => skill.name)).toEqual([
      'answer-playbooks',
      'avery-playbooks',
      'conversation-export',
      'curated-knowledge',
      'dashboard-building',
      'result-validation',
      'sql-analysis',
    ]);
    const named = (name: string) => list.find((skill) => skill.name === name);
    // Elena's playbooks and dashboard rules (plan Elena 2.1).
    for (const name of ['answer-playbooks', 'dashboard-building']) {
      expect(named(name)).toMatchObject({
        loading: 'on-demand',
        agents: ['insights-lead'],
      });
    }
    expect(named('avery-playbooks')).toMatchObject({
      loading: 'on-demand',
      agents: ['chief-of-staff'],
    });
    // The export rules: listed for Avery and Elena, offered only on an export.
    expect(named('conversation-export')).toMatchObject({
      loading: 'on-demand',
      agents: ['chief-of-staff', 'insights-lead'],
    });
    expect(named('curated-knowledge')).toMatchObject({
      loading: 'on-demand',
      agents: ['insights-analyst', 'insights-lead'],
      modified: false,
      builtInChanged: false,
      updatedAt: null,
    });
    // The designer's interactive-visuals went with it (ADR-0059).
    expect(named('interactive-visuals')).toBeUndefined();
  });

  it('no longer ships the deep-analysis skill (removed in 1.23.35)', async () => {
    const { service } = build();
    expect(shippedBuiltIn('deep-analysis')).toBeUndefined();
    await expect(service.get('deep-analysis')).rejects.toThrow(
      'Unknown built-in skill "deep-analysis"',
    );
    expect(
      agentSkillsView('assistant').skills.map((skill) => skill.name),
    ).not.toContain('deep-analysis');
  });

  it('names the tools a built-in body links, and nothing for one that links none', async () => {
    const { service } = build();
    const list = await service.list();
    const byName = new Map(list.map((skill) => [skill.name, skill]));
    expect(byName.get('avery-playbooks')).toMatchObject({
      agents: ['chief-of-staff'],
      tools: [
        'answer_from_data',
        'build_dashboard',
        'export_conversation',
        'ask_clarification',
      ],
    });
    expect(byName.get('curated-knowledge')).not.toHaveProperty('tools');
  });

  it('answers an unknown built-in skill as not found, or as a refusal', async () => {
    const { service } = build();
    await expect(service.get('nope')).rejects.toThrow(
      'Unknown built-in skill "nope"',
    );
    await expect(
      service.save('nope', edited('avery-playbooks')),
    ).rejects.toThrow('Unknown built-in skill "nope"');
    await expect(service.reset('nope')).rejects.toThrow(
      'Unknown built-in skill "nope"',
    );
  });

  it('refuses a save with the first failing check, in the documented order', async () => {
    const { service } = build();
    const ok = edited('avery-playbooks');
    const refusal = (patch: object) =>
      service.save('avery-playbooks', { ...ok, ...patch }).then(
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
          i === 0 ? { ...file, content: 'a {{placeholder}}' } : file,
        ),
      }),
    ).toBe(`${ok.files[0].path} must use no placeholders`);
    expect(await refusal({ files: 'nope' })).toMatch(/is missing/);
  });

  it('refuses a file that drops the placeholders its built-in uses', () => {
    const shipped = {
      description: DESCRIPTION,
      body: 'Body.',
      files: [{ path: 'phases/1-plan.md', content: 'Plan {{question}}.' }],
    };
    const input = {
      description: DESCRIPTION,
      body: 'Body.',
      files: [{ path: 'phases/1-plan.md', content: 'no placeholders' }],
    };
    expect(() => validateOverride(input, shipped)).toThrow(
      'phases/1-plan.md must use the placeholders {{question}}',
    );
    expect(
      validateOverride(
        {
          ...input,
          files: [{ ...input.files[0], content: 'Ask {{question}}' }],
        },
        shipped,
      ).files,
    ).toEqual([{ path: 'phases/1-plan.md', content: 'Ask {{question}}' }]);
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
    const ok = edited('avery-playbooks');
    const plain = ok.files.find((file) => !file.content.includes('{{'));
    expect(plain).toBeDefined();
    await expect(
      service.save('avery-playbooks', {
        ...ok,
        files: ok.files.map((file) =>
          file === plain ? { ...file, content: `${file.content} {{x}}` } : file,
        ),
      }),
    ).rejects.toThrow(`${plain!.path} must use no placeholders`);
  });

  it('leaves everything unchanged when a save is refused', async () => {
    const { service, store } = build();
    const ok = edited('avery-playbooks');
    await expect(
      service.save('avery-playbooks', {
        ...ok,
        files: ok.files.map((file) => ({
          ...file,
          content: 'a {{placeholder}}',
        })),
      }),
    ).rejects.toThrow('must use no placeholders');
    expect(await store.find()).toEqual([]);
    expect(appSkillBody('avery-playbooks')).toBe(
      shippedBuiltIn('avery-playbooks')!.body,
    );
    expect((await service.list()).every((skill) => !skill.modified)).toBe(true);
  });

  it('serves a saved override on the next call, and keeps the built-in layout', async () => {
    const { service, store } = build();
    const input = edited('avery-playbooks');
    const first = input.files[0];

    const saved = await service.save('avery-playbooks', input);
    expect(saved).toMatchObject({
      name: 'avery-playbooks',
      modified: true,
      builtInChanged: false,
      description: DESCRIPTION,
      body: input.body,
      loading: 'on-demand',
      agents: ['chief-of-staff'],
    });
    expect(saved.builtIn.body).toBe(shippedBuiltIn('avery-playbooks')!.body);
    expect(await store.findOne({ name: 'avery-playbooks' })).toMatchObject({
      updatedBy: 'local',
      baseHash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
    });

    // Its reads: the body, the document and a file are the override's.
    expect(appSkillBody('avery-playbooks')).toBe(input.body.trim());
    expect(appSkillDocument('avery-playbooks')).toContain(
      `description: ${DESCRIPTION}`,
    );
    expect(appSkillFile('avery-playbooks', first.path)).toBe(first.content);

    // On demand: the agent's catalogue shows the override.
    expect(
      catalogSkills('chief-of-staff').find(
        (skill) => skill.name === 'avery-playbooks',
      )?.description,
    ).toBe(DESCRIPTION);
    const view = agentSkillsView('chief-of-staff').skills.find(
      (skill) => skill.name === 'avery-playbooks',
    );
    expect(view).toMatchObject({
      modified: true,
      level: 'built-in',
      description: DESCRIPTION,
    });
    const file = view!.files.find((entry) => entry.path === first.path);
    expect(file!.size).toBe(Buffer.byteLength(first.content));
    expect(
      agentSkillFile('chief-of-staff', 'avery-playbooks', first.path),
    ).toMatchObject({ content: first.content });
    expect(
      agentSkillsView('insights-analyst').skills.find(
        (s) => s.name === 'curated-knowledge',
      ),
    ).not.toHaveProperty('modified');
  });

  it("shows an on-demand override in Michael's skills", async () => {
    const { service } = build();
    const curated = (agent: string) =>
      catalogSkills(agent).find((skill) => skill.name === 'curated-knowledge');
    const original = curated('insights-analyst')!;
    await service.save('curated-knowledge', {
      description: DESCRIPTION,
      body: 'Edited curated knowledge.',
      files: [],
    });
    const skill = curated('insights-analyst');
    expect(skill).toMatchObject({
      name: 'curated-knowledge',
      description: DESCRIPTION,
      dir: original.dir,
    });
    expect(
      skillSourcesFor('insights-analyst').find(
        (source) => source.name === 'curated-knowledge',
      ),
    ).toEqual(
      expect.objectContaining({
        name: 'curated-knowledge',
        description: DESCRIPTION,
        body: 'Edited curated knowledge.',
      }),
    );
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
    expect(
      catalogSkills('insights-analyst').find(
        (skill) => skill.name === 'curated-knowledge',
      )?.description,
    ).toBe(shipped.description);
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
    expect(catalogSkills('insights-analyst').map((s) => s.name)).toEqual([
      'curated-knowledge',
      'result-validation',
      'sql-analysis',
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
  it('declares the built-in routes before /skills/:id', () => {
    const order = Object.getOwnPropertyNames(SkillsController.prototype);
    expect(order.indexOf('getBuiltIn')).toBeLessThan(order.indexOf('get'));
    expect(order.indexOf('listBuiltIn')).toBeLessThan(order.indexOf('get'));
  });

  it('answers Style A: a refusal comes back as ok:false', async () => {
    const { service } = build();
    const controller = new SkillsController({} as never, service);
    const refused = await controller.saveBuiltIn('avery-playbooks', {});
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
