import { NodeInspection, NodeRunView } from '../models/workflow-node.model';
import { runStats, runTimeline, stepRunLine } from './workflow-run-story';

function run(overrides: Partial<NodeRunView>): NodeRunView {
  return { status: 'success', durationMs: 2, toolCalls: [], ...overrides };
}

function node(
  nodeId: string,
  kind: NodeInspection['kind'],
  r: NodeRunView | null,
): NodeInspection {
  return {
    nodeId,
    kind,
    title: nodeId,
    number: null,
    summary: '',
    step: null,
    agent: null,
    run: r,
    context: null,
  };
}

describe('stepRunLine (a code step on the canvas, ui.md 4.4b)', () => {
  it("says its story's few words and its time, a concern as a warning", () => {
    expect(
      stepRunLine(
        run({
          story: {
            headline: 'Read 9 tables.',
            brief: '9 tables',
            source: 'step',
          },
        }),
      ),
    ).toEqual({
      text: '9 tables · 2 ms',
      tone: 'success',
      title: 'Read 9 tables.',
    });
    expect(
      stepRunLine(
        run({
          story: {
            headline: '1 of 5 checks failed.',
            brief: '1 of 5 checks failed',
            concern: true,
            source: 'step',
          },
        }),
      )?.tone,
    ).toBe('warning');
  });

  it('says its state without a story, and nothing before a run', () => {
    expect(stepRunLine(run({}))?.text).toBe('Done · 2 ms');
    expect(stepRunLine(run({ status: 'skipped', durationMs: null }))).toEqual({
      text: 'Skipped',
      tone: 'muted',
      title: '',
    });
    expect(
      stepRunLine(
        run({
          status: 'skipped',
          durationMs: null,
          story: {
            headline: 'Skipped: off.',
            brief: 'Off for this run',
            source: 'step',
          },
        }),
      )?.text,
    ).toBe('Off for this run');
    expect(stepRunLine(run({ status: 'failed', error: 'boom' }))).toEqual({
      text: 'Failed · boom',
      tone: 'danger',
      title: '',
    });
    expect(stepRunLine(null)).toBeNull();
  });
});

describe('runTimeline and runStats (How it ran, ui.md 4.4b)', () => {
  const nodes = [
    node('start', 'trigger', run({})),
    node(
      'analyse',
      'agent',
      run({
        startedAt: '2026-11-16T10:00:00.000Z',
        endedAt: '2026-11-16T10:00:15.000Z',
        durationMs: 15000,
        story: {
          headline: 'Ran 3 queries on the data.',
          stats: [{ value: '3', label: 'queries' }],
          source: 'step',
        },
      }),
    ),
    node(
      'validate',
      'code',
      run({
        startedAt: '2026-11-16T10:00:15.000Z',
        endedAt: '2026-11-16T10:00:16.000Z',
        story: {
          headline: '1 of 2 checks failed.',
          concern: true,
          stats: [{ value: '1 / 2', label: 'checks passed' }],
          source: 'step',
        },
      }),
    ),
    node('quality', 'agent', run({ status: 'skipped', durationMs: null })),
    node('write', 'agent', null),
    node('end', 'output', null),
  ];

  it('tells each step, Start and End aside, in one line', () => {
    expect(
      runTimeline(nodes).map((e) => [
        e.node.nodeId,
        e.state,
        e.line,
        e.time,
        e.concern,
      ]),
    ).toEqual([
      ['analyse', 'done', 'Ran 3 queries on the data.', '15.0 s', false],
      ['validate', 'done', '1 of 2 checks failed.', '2 ms', true],
      ['quality', 'skipped', 'Skipped.', '', false],
      ['write', 'pending', 'Not run yet.', '', false],
    ]);
  });

  it("gives how long the run took, then its stories' figures in step order", () => {
    expect(runStats(nodes)).toEqual([
      { value: '16.0 s', label: 'to run' },
      { value: '3', label: 'queries' },
      { value: '1 / 2', label: 'checks passed' },
    ]);
    expect(runStats([node('write', 'agent', null)])).toEqual([]);
  });
});
