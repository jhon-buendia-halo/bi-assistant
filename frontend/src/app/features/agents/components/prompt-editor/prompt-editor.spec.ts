import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Editor } from '@tiptap/core';
import { PromptEditor } from './prompt-editor';

const SKILLS = [
  { name: 'planner', description: 'Use when planning a trip' },
  { name: 'budget', description: 'Use when costing' },
];

describe('PromptEditor', () => {
  let fixture: ComponentFixture<PromptEditor>;
  let emitted: string[];

  async function create(
    value: string,
    inputs: Record<string, unknown> = {},
  ): Promise<Editor> {
    fixture = TestBed.createComponent(PromptEditor);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('skills', SKILLS);
    for (const [name, v] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, v);
    }
    emitted = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.componentInstance as unknown as { editor: Editor })
      .editor;
  }

  /** The suggestion items arrive asynchronously. */
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const menu = () => el().querySelector('[role="listbox"]');
  const options = () =>
    [...el().querySelectorAll('[role="option"] .name')].map(
      (node) => node.textContent?.trim() ?? '',
    );

  it('is a labelled multiline textbox', async () => {
    await create('Hello', { label: 'Instructions' });
    const box = el().querySelector('.ProseMirror')!;
    expect(box.getAttribute('role')).toBe('textbox');
    expect(box.getAttribute('aria-multiline')).toBe('true');
    expect(box.getAttribute('aria-label')).toBe('Instructions');
  });

  it('shows links as chips: skill info, tool neutral, unknown danger', async () => {
    await create(
      'Use [[skill:planner]], [[tool:sample_rows]] and [[skill:gone]].',
    );
    const chip = (id: string) => el().querySelector(`[data-link="${id}"]`)!;
    expect(chip('skill:planner').className).toContain('chip-info');
    expect(chip('tool:sample_rows').className).toContain('chip-neutral');
    expect(chip('skill:gone').className).toContain('chip-danger');
    expect(chip('skill:gone').getAttribute('title')).toBe('Not found');
    expect(chip('skill:planner').textContent).toBe('planner');
  });

  it('round-trips text with links and blank lines exactly', async () => {
    const text =
      'Line one [[skill:planner]]\n\nTools and skills: [[tool:sample_rows]] [[tool:create_visual]]\nlast';
    const editor = await create(text);
    expect(editor.getText({ blockSeparator: '\n' })).toBe(text);

    editor.commands.focus('end');
    editor.commands.insertContent(' more');
    expect(emitted.at(-1)).toBe(text + ' more');
  });

  it('does not open the menu for a "/" inside a word', async () => {
    const editor = await create('');
    editor.commands.focus('end');
    editor.commands.insertContent('speed in km/h');
    await settle();
    expect(menu()).toBeNull();
  });

  it('opens grouped Skills then Tools after a "/" and filters by name or description', async () => {
    const editor = await create('');
    editor.commands.focus('end');
    editor.commands.insertContent('/');
    await settle();
    expect(menu()).not.toBeNull();
    const groups = [...el().querySelectorAll('.group')].map((g) =>
      g.textContent?.trim(),
    );
    expect(groups).toEqual(['Skills', 'Tools']);
    expect(options().slice(0, 2)).toEqual(['planner', 'budget']);

    editor.commands.insertContent('plan');
    await settle();
    expect(options()).toEqual(['planner']);

    // The description matches too.
    editor.commands.deleteRange({
      from: editor.state.selection.from - 4,
      to: editor.state.selection.from,
    });
    editor.commands.insertContent('costing');
    await settle();
    expect(options()).toEqual(['budget']);
  });

  it('inserts the chosen link as [[kind:name]]', async () => {
    const editor = await create('Ask ');
    editor.commands.focus('end');
    editor.commands.insertContent('/plan');
    await settle();
    const option = el().querySelector('[role="option"]') as HTMLElement;
    option.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
    await settle();
    expect(menu()).toBeNull();
    expect(emitted.at(-1)).toBe('Ask [[skill:planner]] ');
  });

  it('the + Link tool button opens the menu with tools only', async () => {
    await create('Hi');
    (el().querySelector('[data-testid="link-tool"]') as HTMLElement).click();
    await settle();
    expect(menu()).not.toBeNull();
    expect(options()).not.toContain('planner');
    expect(options()).toContain('sample_rows');
  });

  it('a body editor offers tools only', async () => {
    await create('', { linkSkills: false });
    expect(el().querySelector('[data-testid="link-skill"]')).toBeNull();
    (el().querySelector('[data-testid="link-tool"]') as HTMLElement).click();
    await settle();
    expect(menu()!.getAttribute('aria-label')).toBe('Tools');
    expect(options()).not.toContain('planner');
  });

  it('refuses an edit past the maximum length and shows the count', async () => {
    const editor = await create('abc', {
      maxLength: 6,
      countTestId: 'count',
    });
    expect(
      el().querySelector('[data-testid="count"]')?.textContent?.trim(),
    ).toBe('3/6');
    editor.commands.focus('end');
    editor.commands.insertContent('defgh');
    await settle();
    expect(editor.getText({ blockSeparator: '\n' })).toBe('abc');
    expect(emitted.every((v) => v.length <= 6)).toBeTrue();
  });
});
