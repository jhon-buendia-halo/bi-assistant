import {
  SKILL_FIELD_LIMITS,
  SkillForm,
  canSaveSkill,
  emptySkillForm,
  skillDeleteConfirm,
  skillFormChanged,
  skillFormFromSkill,
  skillSaveInput,
  usedByLabel,
} from './skill-editor.util';

const form = (patch: Partial<SkillForm> = {}): SkillForm => ({
  ...emptySkillForm(),
  name: 'tournament-lookup',
  description: 'Use when asked about a tournament',
  body: 'Look it up.',
  ...patch,
});

describe('skill editor form', () => {
  it('states the R70 limits', () => {
    expect(SKILL_FIELD_LIMITS).toEqual({
      name: 64,
      description: 300,
      body: 20000,
      fileContent: 20000,
      files: 10,
    });
  });

  it('loads a skill into a copy of its form', () => {
    const skill = {
      id: 's1',
      name: 'a',
      description: 'Use when x',
      body: 'b',
      files: [{ path: 'reference/n.md', content: 'c' }],
      fileCount: 1,
      agents: [],
      tools: [],
      updatedAt: '',
    };
    const loaded = skillFormFromSkill(skill);
    expect(loaded.files).toEqual(skill.files);
    expect(loaded.files[0]).not.toBe(skill.files[0]);
  });

  it('is changed by any field, a file added or a file edited', () => {
    const saved = form({ files: [{ path: 'reference/a.md', content: 'x' }] });
    expect(skillFormChanged(saved, saved)).toBeFalse();
    expect(skillFormChanged(form({ name: 'other' }), form())).toBeTrue();
    expect(skillFormChanged(form({ body: 'x' }), form())).toBeTrue();
    expect(skillFormChanged(form({ files: [] }), saved)).toBeTrue();
    expect(
      skillFormChanged(
        form({ files: [{ path: 'reference/a.md', content: 'y' }] }),
        saved,
      ),
    ).toBeTrue();
    expect(
      skillFormChanged(form({ name: ' tournament-lookup ' }), form()),
    ).toBeFalse();
  });

  it('can be saved with a name, changes and no save in flight', () => {
    expect(
      canSaveSkill({ form: form(), changed: true, saving: false }),
    ).toBeTrue();
    expect(
      canSaveSkill({ form: form(), changed: false, saving: false }),
    ).toBeFalse();
    expect(
      canSaveSkill({ form: form(), changed: true, saving: true }),
    ).toBeFalse();
    expect(
      canSaveSkill({ form: form({ name: ' ' }), changed: true, saving: false }),
    ).toBeFalse();
  });

  it('saves trimmed name, description and paths, the body as typed', () => {
    expect(
      skillSaveInput(
        form({
          name: ' a ',
          description: ' Use when x ',
          body: ' b\n',
          files: [{ path: ' reference/n.md ', content: ' c ' }],
        }),
      ),
    ).toEqual({
      name: 'a',
      description: 'Use when x',
      body: ' b\n',
      files: [{ path: 'reference/n.md', content: ' c ' }],
    });
  });
});

describe('skill copy', () => {
  it('words the delete confirm, with the warning when agents use it', () => {
    expect(skillDeleteConfirm('a', [])).toBe('Delete "a"?');
    expect(skillDeleteConfirm('a', ['X'])).toBe(
      'Delete "a"?\n\nAgents using it keep it in their Live version until republished.',
    );
  });

  it('words who uses a skill', () => {
    expect(usedByLabel([])).toBe('Not used by any agent');
    expect(usedByLabel(['A', 'B'])).toBe('Used by A, B');
  });
});
