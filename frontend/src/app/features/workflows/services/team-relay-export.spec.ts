import { ActivityStep } from './agent-activity';
import { relayOf } from './team-relay';

const step = (over: Partial<ActivityStep>): ActivityStep => ({
  label: over.tool ?? 'step',
  state: 'done',
  rows: null,
  query: false,
  tool: 'tool',
  detail: '',
  ...over,
});

const labelOf = (over: Partial<ActivityStep>): string | false => {
  const items = relayOf(
    [step({ tool: 'export_conversation', agent: 'chief-of-staff', ...over })],
    [],
  );
  return items[0].kind === 'step' && items[0].step.label;
};

describe('relayOf, the conversation export (agents.md 3.18)', () => {
  it('says Avery is exporting, then that she exported', () => {
    expect(labelOf({ state: 'current' })).toBe(
      'Exporting the conversation to PDF and PowerPoint…',
    );
    expect(labelOf({ state: 'done' })).toBe('Exported the conversation');
    expect(labelOf({ state: 'failed' })).toBe(
      "Couldn't export the conversation",
    );
  });

  it('names the export playbook she reads', () => {
    const items = relayOf(
      [
        step({
          tool: 'skill_read',
          agent: 'chief-of-staff',
          input: 'reference/export.md',
        }),
      ],
      [],
    );
    expect(items[0].kind === 'step' && items[0].step.label).toBe(
      'Read how to export the conversation',
    );
  });
});
