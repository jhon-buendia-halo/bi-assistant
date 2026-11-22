import { WorkflowTeamMember } from '../models/workflow.model';
import { ActivityStep } from './agent-activity';
import { RelayHandOff, relayOf, relaySentence } from './team-relay';

const TEAM: WorkflowTeamMember[] = [
  {
    tool: 'answer_from_data',
    key: 'insights-analyst',
    name: 'Michael',
    role: 'Insights Analyst',
  },
  {
    tool: 'plan_analysis',
    key: 'analysis-planner',
    name: 'Olivia',
    role: 'Analysis Lead',
  },
];

const step = (over: Partial<ActivityStep>): ActivityStep => ({
  label: over.tool ?? 'step',
  state: 'done',
  rows: null,
  query: false,
  tool: 'tool',
  detail: '',
  ...over,
});

const AVERY = 'chief-of-staff';

describe('relayOf (ui.md 4.4b relay)', () => {
  it("tells Avery's steps in her words and nests Michael's work under her hand-off", () => {
    const items = relayOf(
      [
        step({ tool: 'skill', input: 'avery-playbooks', agent: AVERY }),
        step({
          tool: 'answer_from_data',
          input: 'How many goals were scored in each World Cup?',
          agent: AVERY,
          teammate: 'insights-analyst',
        }),
        step({
          tool: 'run_readonly_sql',
          label: 'Added up the goals',
          rows: '2 rows',
          query: true,
        }),
        step({
          tool: 'run_readonly_sql',
          label: 'Checked the stages',
          rows: '8 rows',
          query: true,
        }),
        step({
          tool: 'skill_read',
          input: 'references/no-answer.md',
          agent: AVERY,
        }),
      ],
      TEAM,
    );
    expect(items.map((item) => item.kind)).toEqual([
      'step',
      'step',
      'teammate',
      'step',
    ]);
    const label = (i: number) =>
      items[i].kind === 'step' ? items[i].step.label : '';
    expect(label(0)).toBe('Checked my playbook for this kind of question');
    expect(label(1)).toBe(
      'Asked Michael: “How many goals were scored in each World Cup?”',
    );
    expect(label(3)).toBe("Read what to do when the data can't answer it all");
    const michael = items[2] as RelayHandOff;
    expect(michael.teammate).toEqual({
      key: 'insights-analyst',
      name: 'Michael',
      role: 'Insights Analyst',
    });
    expect(michael.queries).toBe(2);
    expect(michael.steps.map((s) => [s.label, s.rows])).toEqual([
      ['Added up the goals', '2 rows'],
      ['Checked the stages', '8 rows'],
      ['Wrote the answer', null],
    ]);
    expect(relaySentence('done', items)).toBe(
      'I asked Michael to work on your question, then checked the answer before handing it to you.',
    );
  });

  it('while a teammate works, the hand-off is current and hands nothing back yet', () => {
    const items = relayOf(
      [
        step({
          tool: 'plan_analysis',
          agent: AVERY,
          teammate: 'analysis-planner',
          state: 'current',
        }),
      ],
      TEAM,
    );
    const olivia = items[1] as RelayHandOff;
    expect(items[0].kind === 'step' && items[0].step.label).toBe(
      'Asking Olivia for a plan',
    );
    expect(olivia.state).toBe('current');
    expect(olivia.steps.map((s) => [s.label, s.state])).toEqual([
      ['Working on it…', 'current'],
    ]);
    expect(relaySentence('active', items)).toBe(
      'Working with Olivia on your question.',
    );

    const querying = relayOf(
      [
        step({
          tool: 'answer_from_data',
          agent: AVERY,
          teammate: 'insights-analyst',
        }),
        step({ tool: 'run_readonly_sql', query: true, state: 'current' }),
      ],
      TEAM,
    );
    expect((querying[1] as RelayHandOff).state).toBe('current');
    expect((querying[1] as RelayHandOff).steps.map((s) => s.label)).toEqual([
      'run_readonly_sql',
    ]);
  });

  it('quotes the question a brief restates, else its first sentence', () => {
    const asked = (input: string) => {
      const [ask] = relayOf(
        [
          step({
            tool: 'answer_from_data',
            input,
            agent: AVERY,
            teammate: 'insights-analyst',
          }),
        ],
        TEAM,
      );
      return ask.kind === 'step' ? ask.step.label : '';
    };
    expect(
      asked(
        'Pregunta del usuario (en español): "¿Qué selección marcó más goles en total?" — es decir, qué selección nacional…',
      ),
    ).toBe('Asked Michael: “¿Qué selección marcó más goles en total?”');
    expect(
      asked('Count every match per stage. Then check the totals add up.'),
    ).toBe('Asked Michael: “Count every match per stage.”');
  });

  it('names several teammates in order, once each', () => {
    const items = relayOf(
      [
        step({
          tool: 'plan_analysis',
          agent: AVERY,
          teammate: 'analysis-planner',
        }),
        step({
          tool: 'answer_from_data',
          agent: AVERY,
          teammate: 'insights-analyst',
        }),
        step({
          tool: 'answer_from_data',
          agent: AVERY,
          teammate: 'insights-analyst',
        }),
      ],
      TEAM,
    );
    expect(relaySentence('done', items)).toBe(
      'I asked Olivia and Michael to work on your question, then checked the answer before handing it to you.',
    );
  });

  it('is empty for a step with no signed call (a run stored before the relay), and has no sentence without a hand-off', () => {
    expect(
      relayOf([step({ tool: 'run_readonly_sql', query: true })], TEAM),
    ).toEqual([]);
    const alone = relayOf([step({ tool: 'skill', agent: AVERY })], TEAM);
    expect(alone.length).toBe(1);
    expect(relaySentence('done', alone)).toBeNull();
  });
});
