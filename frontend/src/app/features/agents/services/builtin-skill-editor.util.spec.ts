import {
  BUILT_IN_DRIFT_NOTICE,
  BuiltInSkillForm,
  builtInFormChanged,
  builtInFormFromSkill,
  builtInResetConfirm,
  builtInRowNotice,
  builtInSaveInput,
  canSaveBuiltIn,
  loadingChipLabel,
} from './builtin-skill-editor.util';
import { BuiltInSkill } from './skills-api.service';

const skill: BuiltInSkill = {
  name: 'deep-analysis',
  description: 'Use when analysing',
  loading: 'on-demand',
  agents: [],
  modified: false,
  builtInChanged: false,
  updatedAt: null,
  body: 'Body',
  files: [{ path: 'reference/a.md', content: 'A' }],
  builtIn: { description: 'Use when analysing', body: 'Body', files: [] },
};

describe('built-in skill editor util', () => {
  it('builds the form from the skill, copying files', () => {
    const form = builtInFormFromSkill(skill);
    expect(form).toEqual({
      description: 'Use when analysing',
      body: 'Body',
      files: [{ path: 'reference/a.md', content: 'A' }],
    });
    expect(form.files[0]).not.toBe(skill.files[0]);
  });

  it('detects changes in description, body and file content', () => {
    const saved = builtInFormFromSkill(skill);
    expect(builtInFormChanged(saved, saved)).toBe(false);
    expect(builtInFormChanged({ ...saved, body: 'x' }, saved)).toBe(true);
    expect(
      builtInFormChanged(
        { ...saved, description: ' Use when analysing ' },
        saved,
      ),
    ).toBe(false);
    const edited: BuiltInSkillForm = {
      ...saved,
      files: [{ path: 'reference/a.md', content: 'B' }],
    };
    expect(builtInFormChanged(edited, saved)).toBe(true);
  });

  it('enables Save only with permission, changes and no save in flight', () => {
    const ok = { canEdit: true, changed: true, saving: false };
    expect(canSaveBuiltIn(ok)).toBe(true);
    expect(canSaveBuiltIn({ ...ok, canEdit: false })).toBe(false);
    expect(canSaveBuiltIn({ ...ok, changed: false })).toBe(false);
    expect(canSaveBuiltIn({ ...ok, saving: true })).toBe(false);
  });

  it('builds the PUT payload without a name', () => {
    expect(
      builtInSaveInput({
        description: ' Use when x ',
        body: 'b',
        files: [{ path: 'reference/a.md', content: 'A' }],
      }),
    ).toEqual({
      description: 'Use when x',
      body: 'b',
      files: [{ path: 'reference/a.md', content: 'A' }],
    });
  });

  it('words the reset confirm, the loading chip and the drift notice', () => {
    expect(builtInResetConfirm('deep-analysis')).toBe(
      'Reset "deep-analysis" to the built-in version?',
    );
    expect(loadingChipLabel('on-demand')).toBe('On demand');
    expect(loadingChipLabel('harness')).toBe('Loaded by the app');
    expect(
      builtInRowNotice({ ...skill, modified: true, builtInChanged: true }),
    ).toBe(BUILT_IN_DRIFT_NOTICE);
    expect(builtInRowNotice({ ...skill, builtInChanged: true })).toBeNull();
  });
});
