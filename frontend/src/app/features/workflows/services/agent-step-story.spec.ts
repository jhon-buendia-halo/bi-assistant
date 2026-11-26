import { WorkflowDetailStep, WorkflowRunStep } from '../models/workflow.model';
import {
  agentStepStories,
  handoffLine,
  listOf,
  teamActivity,
  thirdPerson,
  upNextLine,
} from './agent-step-story';

function step(
  id: string,
  title: string,
  agent?: { key: string; name: string; role: string },
  output: string[] = [],
): WorkflowDetailStep {
  return {
    id,
    title,
    kind: agent ? 'agent' : 'code',
    summary: '',
    input: [],
    output,
    exits: [],
    ...(agent
      ? { agent: { ...agent, tools: [], maxSteps: agent.key === 'a' ? 1 : 15 } }
      : {}),
  } as unknown as WorkflowDetailStep;
}

const OLIVIA = {
  key: 'analysis-planner',
  name: 'Olivia',
  role: 'Analysis Lead',
};
const MICHAEL = {
  key: 'insights-analyst',
  name: 'Michael',
  role: 'Insights Analyst',
};
const JESSICA = {
  key: 'answer-writer',
  name: 'Jessica',
  role: 'Insights Writer',
};

const STEPS = [
  step('load-catalog', 'Load catalog'),
  step('plan', 'Plan', OLIVIA, ['question', 'plan', 'catalog']),
  step('analyse', 'Analyse', MICHAEL, ['answer', 'queries']),
  step('write-answer', 'Write answer', JESSICA, ['answer']),
];

const PLANNED: WorkflowRunStep = {
  id: 'plan',
  title: 'Plan',
  status: 'success',
  startedAt: '2026-11-15T10:00:00.000Z',
  endedAt: '2026-11-15T10:00:01.200Z',
  output: {
    measures: ['goals per player'],
    entities: ['goals', 'players'],
    needsClarification: false,
  },
};

describe('agent step stories (ui.md 4.4b, Agents at work)', () => {
  it('tells nothing before a run, and skips code steps', () => {
    const stories = agentStepStories({
      steps: STEPS,
      runSteps: [],
      running: false,
    });
    expect([...stories.keys()]).toEqual(['plan', 'analyse', 'write-answer']);
    const plan = stories.get('plan')!;
    expect(plan.state).toBe('idle');
    expect(plan.line).toBe('');
    expect(plan.sentence).toBeNull();
    expect(plan.agent).toEqual(OLIVIA);
  });

  it('tells a run in progress: done, active with its query count, waiting', () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: true,
      runSteps: [
        { id: 'load-catalog', title: 'Load catalog', status: 'success' },
        PLANNED,
        {
          id: 'analyse',
          title: 'Analyse',
          status: 'running',
          toolCalls: [
            { tool: 'list_entities' },
            { tool: 'run_readonly_sql', rowCount: 5 },
            { tool: 'run_readonly_sql', rowCount: 1 },
          ],
        },
      ],
    });
    const plan = stories.get('plan')!;
    expect(plan.state).toBe('done');
    expect(plan.line).toBe('Done · 1.2 s');
    expect(plan.sentence).toBe(
      "I'll work out goals per player from goals and players.",
    );
    const analyse = stories.get('analyse')!;
    expect(analyse.state).toBe('active');
    expect(analyse.queries).toBe(2);
    expect(analyse.line).toBe('Running query 2');
    expect(analyse.sentence).toBe("I'm running query 2…");
    const write = stories.get('write-answer')!;
    expect(write.state).toBe('waiting');
    expect(write.line).toBe('Waiting for Michael');
    expect(write.sentence).toBeNull();

    expect(teamActivity(stories.values())).toBe('Michael is running query 2');
    expect(handoffLine(plan, analyse)).toBe(
      'Olivia passed question, plan and catalog to Michael',
    );
    expect(handoffLine(analyse, write)).toBeNull();
    // The waiting agents, on one line.
    expect(upNextLine(stories.values())).toBe('Jessica writes the answer');
    // A stored running step's calls read as steps, none of them spinning.
    expect(analyse.activity.map((a) => [a.label, a.state, a.rows])).toEqual([
      ['Looked at the tables', 'done', null],
      ['Ran a query', 'done', '5 rows'],
      ['Ran a query', 'done', '1 row'],
    ]);
  });

  it("reads the streamed calls of the running step as its steps, the agent's reason first", () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: true,
      runSteps: [
        PLANNED,
        { id: 'analyse', title: 'Analyse', status: 'running' },
      ],
      liveToolCalls: [
        { name: 'describe_entity', input: 'goals', finished: false },
        {
          name: 'run_readonly_sql',
          rationale: 'Goals per team',
          rowCount: 66,
          finished: true,
        },
        { name: 'skill', input: 'ranking', finished: false },
      ],
    });
    const analyse = stories.get('analyse')!;
    expect(analyse.activity.map((a) => [a.label, a.state])).toEqual([
      ['Read the columns of goals', 'done'],
      ['Goals per team', 'done'],
      ['Reading the ranking skill…', 'current'],
    ]);
    expect(analyse.doing).toBe('reading a skill');

    // Its latest call ended: it is deciding what to do next.
    const between = agentStepStories({
      steps: STEPS,
      running: true,
      runSteps: [PLANNED, { id: 'analyse', title: 'Analyse', status: 'running' }],
      liveToolCalls: [{ name: 'skill', input: 'ranking', finished: true }],
    }).get('analyse')!;
    expect(between.sentence).toBe("I'm working out the next step…");
  });

  it('says what a waiting agent will do, in the third person', () => {
    expect(thirdPerson('Write answer')).toBe('writes the answer');
    expect(thirdPerson('Build visual')).toBe('builds the visual');
    expect(thirdPerson('Clarify')).toBe('clarifies');
    expect(thirdPerson('Analyse')).toBe('analyses');
    expect(thirdPerson('Fix SQL')).toBe('fixes the SQL');
  });

  it("says a done or skipped step's story in a few words on its line, a concern flagged", () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: false,
      runSteps: [
        {
          ...PLANNED,
          story: {
            headline: 'Read the question as …',
            brief: 'Needs your answer',
            concern: true,
            source: 'step',
          },
        },
        {
          id: 'analyse',
          title: 'Analyse',
          status: 'skipped',
          story: {
            headline: 'Skipped: off.',
            brief: 'Off for this run',
            source: 'step',
          },
        },
      ],
    });
    expect(stories.get('plan')!.line).toBe('Needs your answer · 1.2 s');
    expect(stories.get('plan')!.concern).toBeTrue();
    expect(stories.get('analyse')!.line).toBe('Off for this run');
    expect(stories.get('analyse')!.concern).toBeFalse();
  });

  it('prefers the streamed tool calls of the running step', () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: true,
      runSteps: [
        PLANNED,
        { id: 'analyse', title: 'Analyse', status: 'running' },
      ],
      liveToolCalls: [{ name: 'describe_entity', finished: false }],
    });
    expect(stories.get('analyse')!.line).toBe('Reading the columns');
  });

  it('says what a finished analysis ran, and a failure in its own words', () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: false,
      runSteps: [
        PLANNED,
        {
          id: 'analyse',
          title: 'Analyse',
          status: 'success',
          toolCalls: [
            { tool: 'run_readonly_sql', rowCount: 10 },
            { tool: 'run_readonly_sql', error: 'syntax error' },
          ],
        },
        {
          id: 'write-answer',
          title: 'Write answer',
          status: 'failed',
          error: 'The model returned an error',
        },
      ],
    });
    expect(stories.get('analyse')!.sentence).toBe(
      'I ran 2 queries (1 failed) and got 10 rows back.',
    );
    const write = stories.get('write-answer')!;
    expect(write.line).toBe('Failed · The model returned an error');
    expect(write.sentence).toBe(
      "I couldn't finish: The model returned an error",
    );
  });

  it('says when an agent waits for the user, and an idle step with no work', () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: true,
      runSteps: [
        PLANNED,
        { id: 'analyse', title: 'Analyse', status: 'suspended' },
      ],
    });
    expect(stories.get('analyse')!.line).toBe('Waiting for your answer');
    expect(teamActivity(stories.values())).toBe(
      'Michael is waiting for your answer',
    );
    // A step that has not started names its own action while it waits.
    const planning = agentStepStories({
      steps: STEPS,
      running: true,
      runSteps: [{ id: 'plan', title: 'Plan', status: 'running' }],
    });
    expect(planning.get('plan')!.line).toBe('Planning');
    expect(planning.get('write-answer')!.line).toBe('Waiting for Olivia');
  });

  it('quotes a step that returns its own words', () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: false,
      runSteps: [
        {
          id: 'write-answer',
          title: 'Write answer',
          status: 'success',
          output: {
            answer: '**Mbappé scored 8 goals.** He led the tournament.',
          },
        },
      ],
    });
    expect(stories.get('write-answer')!.sentence).toBe(
      'Done: “Mbappé scored 8 goals.”',
    );
  });

  it('reads a plan nested under `plan`, tables by their own name', () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: false,
      runSteps: [
        {
          id: 'plan',
          title: 'Plan',
          status: 'success',
          output: {
            question: 'q',
            plan: {
              measures: ['goals per player', 'penalty goals', 'own goals'],
              entities: [
                'world_cup.world_cup.goals',
                'world_cup.world_cup.players',
              ],
            },
          },
        },
      ],
    });
    expect(stories.get('plan')!.sentence).toBe(
      "I'll work out goals per player and 2 more from goals and players.",
    );
  });

  it('lets a step that passes the plan along speak of its own queries', () => {
    const stories = agentStepStories({
      steps: STEPS,
      running: false,
      runSteps: [
        {
          id: 'analyse',
          title: 'Analyse',
          status: 'success',
          output: { plan: { measures: ['wins'], entities: ['matches'] } },
          toolCalls: [{ tool: 'run_readonly_sql', rowCount: 4 }],
        },
      ],
    });
    expect(stories.get('analyse')!.sentence).toBe(
      'I ran 1 query and got 4 rows back.',
    );
  });

  it('joins lists in plain words', () => {
    expect(listOf(['a'], 3)).toBe('a');
    expect(listOf(['a', 'b'], 3)).toBe('a and b');
    expect(listOf(['a', 'b', 'c', 'd', 'e'], 3)).toBe('a, b and 3 more');
  });
});
