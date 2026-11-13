import {
  WorkflowDetail,
  WorkflowDetailStep,
  WorkflowInputField,
} from '../models/workflow.model';
import {
  CANVAS,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  fitZoom,
  workflowCanvasLayout,
  zoomIn,
  zoomOut,
} from './workflow-canvas-layout';
import { GRAPH_WORKFLOW } from './workflow-graph.testing';

type Source = Pick<WorkflowDetail, 'input' | 'steps' | 'agents'>;

const code = (
  id: string,
  input: string[],
  output: string[],
  exits: WorkflowDetailStep['exits'] = [],
): WorkflowDetailStep => ({
  id,
  title: `Title ${id}`,
  kind: 'code',
  summary: `${id} summary`,
  input,
  output,
  exits,
});

const agentStep = (id: string, tools: string[]): WorkflowDetailStep => ({
  ...code(
    id,
    ['question', 'catalog'],
    ['calls', 'stopped'],
    [
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
    ],
  ),
  title: 'Analyse',
  kind: 'agent',
  agent: {
    name: 'Questions to Insights v2',
    tools,
    maxSteps: 15,
    key: 'assistant-v2',
  },
});

const field = (name: string): WorkflowInputField => ({
  name,
  label: name,
  type: 'text',
  required: true,
});

const AGENTS: WorkflowDetail['agents'] = [
  {
    key: 'assistant-v2',
    name: 'Questions to Insights v2',
    model: 'anthropic/claude-sonnet-5-5',
  },
];

/** Questions to Insights v2: four steps, the third an agent with three tools. */
const V2: Source = {
  input: [field('question'), field('datasets')],
  agents: AGENTS,
  steps: [
    code('receive-question', ['question', 'datasets'], ['question', 'datasets']),
    code('load-catalog', ['question', 'datasets'], ['question', 'catalog']),
    agentStep('analyse', [
      'list_entities',
      'describe_entity',
      'run_readonly_sql',
    ]),
    code(
      'wrap-up',
      ['calls', 'stopped'],
      ['sqlQueries', 'failedQueries', 'rows'],
    ),
  ],
};

describe('workflowCanvasLayout (ui.md 4.4b)', () => {
  it('keeps the contract constants', () => {
    expect(CANVAS).toEqual({
      padding: 40,
      square: 88,
      agentWidth: 220,
      nodeHeight: 88,
      colGap: 80,
      labelHeight: 52,
      exitRowHeight: 16,
      subSize: 56,
      subSpacing: 120,
      subTop: 96,
      subLabelHeight: 40,
      maxToolSubNodes: 4,
    });
    expect([...ZOOM_LEVELS]).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
    expect(MIN_ZOOM).toBe(0.4);
    expect(MAX_ZOOM).toBe(1.5);
  });

  it('one step: Start, the step and End in columns left to right on one centre line', () => {
    const layout = workflowCanvasLayout({
      input: [field('text')],
      agents: [],
      steps: [code('clean', ['text'], ['text', 'words'])],
    });
    expect(
      layout.nodes.map((n) => [n.kind, n.id, n.x, n.y, n.width, n.height]),
    ).toEqual([
      ['trigger', 'start', 40, 40, 88, 88],
      ['code', 'clean', 208, 40, 88, 88],
      ['output', 'end', 376, 40, 88, 88],
    ]);
    expect(layout.nodes.map((n) => n.centerY)).toEqual([84, 84, 84]);
    expect(layout.nodes.map((n) => n.number)).toEqual([null, 1, null]);
    expect(layout.nodes.map((n) => [n.title, n.subtitle])).toEqual([
      ['Start', 'text'],
      ['Title clean', 'clean'],
      ['End', 'text, words'],
    ]);
    expect(layout.width).toBe(376 + 88 + 40);
    // Start's exit note row sits under its label.
    expect(layout.height).toBe(40 + 88 + 52 + 16 + 40);
  });

  it('three code steps: no room above the row, each step one square column', () => {
    const layout = workflowCanvasLayout({
      input: [field('text')],
      agents: [],
      steps: [
        code('a', ['text'], ['text']),
        code('b', ['text'], ['n'], [{ label: 'Too long', outcome: 'fails' }]),
        code('c', ['n'], ['result']),
      ],
    });
    expect(layout.nodes.map((n) => n.x)).toEqual([40, 208, 376, 544, 712]);
    expect(new Set(layout.nodes.map((n) => n.y))).toEqual(new Set([40]));
    expect(
      layout.nodes.every(
        (n) => n.ports.length === 0 && n.subNodes.length === 0,
      ),
    ).toBe(true);
    expect(layout.nodes.map((n) => n.agentLine)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    // Start's exit: an invalid input never starts the run.
    expect(layout.nodes[0].exits).toEqual([
      {
        text: 'Invalid input → not started',
        outcome: 'fails',
        x: 40 + 44,
        y: 40 + 88 + 52,
      },
    ]);
    // A code step's exit sits under its label, centred on the node.
    expect(layout.nodes[2].exits).toEqual([
      {
        text: 'Too long → fails',
        outcome: 'fails',
        x: 376 + 44,
        y: 40 + 88 + 52,
      },
    ]);
    expect(layout.height).toBe(40 + 88 + 52 + 16 + 40);
  });

  it('four steps (Questions to Insights v2): the agent is a wide node, exits above it', () => {
    const layout = workflowCanvasLayout(V2);
    // Two agent exit rows and their gap above the row.
    const top = 40 + 2 * 16 + 12;
    expect(layout.nodes.map((n) => [n.id, n.kind, n.x, n.width])).toEqual([
      ['start', 'trigger', 40, 88],
      ['receive-question', 'code', 208, 88],
      ['load-catalog', 'code', 376, 88],
      ['analyse', 'agent', 544, 220],
      ['wrap-up', 'code', 844, 88],
      ['end', 'output', 1012, 88],
    ]);
    expect(new Set(layout.nodes.map((n) => n.y))).toEqual(new Set([top]));
    expect(new Set(layout.nodes.map((n) => n.centerY))).toEqual(
      new Set([top + 44]),
    );

    const analyse = layout.nodes[3];
    expect(analyse.agentLine).toBe('Questions to Insights v2 · ≤ 15 steps');
    expect(analyse.exits).toEqual([
      {
        text: 'Model error → fails',
        outcome: 'fails',
        x: 654,
        y: top - 12 - 32,
      },
      { text: 'Stop → ends here', outcome: 'stops', x: 654, y: top - 12 - 16 },
    ]);
    expect(analyse.ports).toEqual([
      { kind: 'model', label: 'Model', x: 544 + 55, y: top + 88 },
      { kind: 'tool', label: 'Tools', x: 544 + 165, y: top + 88 },
    ]);
    expect(layout.nodes[0].subtitle).toBe('question, datasets');
    expect(layout.nodes[5].subtitle).toBe('sqlQueries, failedQueries, rows');
    expect(layout.width).toBe(1012 + 88 + 40);
    expect(layout.height).toBe(top + 88 + 96 + 56 + 40 + 40);
  });

  it('hangs the model and each tool under the agent, left to right from its left edge', () => {
    const layout = workflowCanvasLayout(V2);
    const analyse = layout.nodes[3];
    const subTop = analyse.y + 88 + 96;
    expect(analyse.subNodes).toEqual([
      {
        id: 'analyse-model',
        kind: 'model',
        label: 'claude-sonnet-5-5',
        subtitle: 'model',
        x: 576,
        y: subTop,
        size: 56,
      },
      {
        id: 'analyse-tool-list_entities',
        kind: 'tool',
        label: 'list_entities',
        subtitle: 'tool',
        x: 696,
        y: subTop,
        size: 56,
      },
      {
        id: 'analyse-tool-describe_entity',
        kind: 'tool',
        label: 'describe_entity',
        subtitle: 'tool',
        x: 816,
        y: subTop,
        size: 56,
      },
      {
        id: 'analyse-tool-run_readonly_sql',
        kind: 'tool',
        label: 'run_readonly_sql',
        subtitle: 'tool',
        x: 936,
        y: subTop,
        size: 56,
      },
    ]);
    expect(layout.subEdges.map((e) => [e.id, e.nodeId, e.subNodeId])).toEqual([
      ['analyse-model-edge', 'analyse', 'analyse-model'],
      [
        'analyse-tool-list_entities-edge',
        'analyse',
        'analyse-tool-list_entities',
      ],
      [
        'analyse-tool-describe_entity-edge',
        'analyse',
        'analyse-tool-describe_entity',
      ],
      [
        'analyse-tool-run_readonly_sql-edge',
        'analyse',
        'analyse-tool-run_readonly_sql',
      ],
    ]);
    const mid = (analyse.y + 88 + subTop) / 2;
    // From the Model port down to the model; from the Tools port to each tool.
    expect(layout.subEdges[0].path).toBe(
      `M 599 ${analyse.y + 88} C 599 ${mid}, 604 ${mid}, 604 ${subTop}`,
    );
    expect(layout.subEdges[1].path.startsWith(`M 709 ${analyse.y + 88} `)).toBe(
      true,
    );
  });

  it('caps the tool sub-nodes at four, then one "+<n> tools"', () => {
    const tools = ['t1', 't2', 't3', 't4', 't5', 't6'];
    const layout = workflowCanvasLayout({
      input: [],
      agents: AGENTS,
      steps: [agentStep('ask', tools)],
    });
    const ask = layout.nodes[1];
    expect(
      ask.subNodes.map((s) => [s.id, s.kind, s.label, s.subtitle]),
    ).toEqual([
      ['ask-model', 'model', 'claude-sonnet-5-5', 'model'],
      ['ask-tool-t1', 'tool', 't1', 'tool'],
      ['ask-tool-t2', 'tool', 't2', 'tool'],
      ['ask-tool-t3', 'tool', 't3', 'tool'],
      ['ask-tool-t4', 'tool', 't4', 'tool'],
      ['ask-more', 'more', '+2 tools', ''],
    ]);
    expect(layout.subEdges.length).toBe(6);
    // The sub-node row reaches past End: the canvas grows to hold it.
    const lastSub = ask.subNodes[5];
    expect(layout.width).toBe(lastSub.x + 28 + 60 + 40);
  });

  it('a model it cannot resolve reads "No model set"', () => {
    const keyless = agentStep('a', []);
    delete keyless.agent!.key;
    const noKey = workflowCanvasLayout({
      input: [],
      agents: AGENTS,
      steps: [keyless],
    });
    const nullModel = workflowCanvasLayout({
      input: [],
      agents: [{ key: 'assistant-v2', name: 'x', model: null }],
      steps: [agentStep('a', [])],
    });
    const unknown = workflowCanvasLayout({
      input: [],
      agents: [],
      steps: [agentStep('a', [])],
    });
    for (const layout of [noKey, nullModel, unknown]) {
      expect(layout.nodes[1].subNodes.map((s) => s.label)).toEqual([
        'No model set',
      ]);
    }
    const bare = workflowCanvasLayout({
      input: [],
      agents: [{ key: 'assistant-v2', name: 'x', model: 'gpt-5' }],
      steps: [agentStep('a', [])],
    });
    expect(bare.nodes[1].subNodes[0].label).toBe('gpt-5');
  });

  it('joins consecutive nodes with labelled edges carrying the fields passed on', () => {
    const layout = workflowCanvasLayout(V2);
    const cy = layout.nodes[0].centerY;
    expect(layout.edges.map((e) => [e.id, e.from, e.to, e.label])).toEqual([
      ['start-receive-question', 'start', 'receive-question', '2 fields'],
      [
        'receive-question-load-catalog',
        'receive-question',
        'load-catalog',
        '2 fields',
      ],
      ['load-catalog-analyse', 'load-catalog', 'analyse', '2 fields'],
      ['analyse-wrap-up', 'analyse', 'wrap-up', '2 fields'],
      ['wrap-up-end', 'wrap-up', 'end', '3 fields'],
    ]);
    expect(layout.edges[0].fields).toEqual(['question', 'datasets']);
    expect(layout.edges[4].fields).toEqual([
      'sqlQueries',
      'failedQueries',
      'rows',
    ]);
    expect(layout.edges[0].path).toBe(`M 128 ${cy} L 208 ${cy}`);
    expect([layout.edges[0].labelX, layout.edges[0].labelY]).toEqual([
      168,
      cy - 12,
    ]);
    expect(layout.edges[3].path).toBe(`M 764 ${cy} L 844 ${cy}`);

    const one = workflowCanvasLayout({
      input: [],
      agents: [],
      steps: [code('a', [], ['x'])],
    });
    expect(one.edges.map((e) => e.label)).toEqual(['', '1 field']);
    expect(one.edges[0].fields).toEqual([]);
  });

  it('no steps: Start straight to End', () => {
    const layout = workflowCanvasLayout({ input: [], agents: [], steps: [] });
    expect(layout.nodes.map((n) => n.id)).toEqual(['start', 'end']);
    expect(layout.edges.map((e) => [e.id, e.label])).toEqual([
      ['start-end', ''],
    ]);
    expect(layout.nodes[1].subtitle).toBe('');
  });
});

describe('workflowCanvasLayout from edges (a branch and a loop)', () => {
  const layout = workflowCanvasLayout(GRAPH_WORKFLOW);
  const node = (id: string) => layout.nodes.find((n) => n.id === id)!;
  const edge = (id: string) => layout.edges.find((e) => e.id === id)!;

  it('every linear edge is `next`', () => {
    expect(workflowCanvasLayout(V2).edges.every((e) => e.kind === 'next')).toBeTrue();
  });

  it('puts the main path left to right on one centre line, Clarify below Plan', () => {
    const main = ['start', 'receive-question', 'load-catalog', 'plan', 'analyse', 'validate', 'write-answer', 'wrap-up', 'end'];
    const xs = main.map((id) => node(id).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const cy = node('start').centerY;
    for (const id of main) expect(node(id).centerY).withContext(id).toBe(cy);
    const clarify = node('clarify');
    expect(clarify.y).toBeGreaterThan(node('plan').y + CANVAS.nodeHeight);
    // Below the sub-nodes hanging under the agents.
    const subBottom = Math.max(...node('plan').subNodes.map((s) => s.y + s.size));
    expect(clarify.y).toBeGreaterThan(subBottom);
    // Between Plan and Analyse.
    expect(clarify.x + clarify.width / 2).toBeGreaterThan(node('plan').x + node('plan').width);
    expect(clarify.x + clarify.width / 2).toBeLessThan(node('analyse').x);
    expect(layout.height).toBeGreaterThan(clarify.y + clarify.height);
  });

  it('draws one edge per graph edge, each with its kind and label', () => {
    expect(layout.edges.map((e) => [e.id, e.kind, e.branchLabel])).toEqual([
      ['start-receive-question', 'next', null],
      ['receive-question-load-catalog', 'next', null],
      ['load-catalog-plan', 'next', null],
      ['plan-clarify', 'branch', 'Needs clarification'],
      ['plan-analyse', 'branch', 'Clear'],
      ['analyse-validate', 'next', null],
      ['validate-analyse', 'loop', 'Retry once'],
      ['validate-write-answer', 'next', 'Valid or retried'],
      ['write-answer-wrap-up', 'next', null],
      ['wrap-up-end', 'next', null],
      ['clarify-end', 'next', null],
    ]);
  });

  it('runs the branch down to Clarify and Clarify on to End', () => {
    const clarify = node('clarify');
    const branch = edge('plan-clarify');
    expect(branch.path.startsWith(`M ${node('plan').x + node('plan').width} ${node('plan').centerY}`)).toBeTrue();
    expect(branch.path.endsWith(`${clarify.y}`)).toBeTrue();
    expect(branch.branchLabelY).toBeGreaterThan(node('plan').y + CANVAS.nodeHeight);
    expect(branch.branchLabelY).toBeLessThan(clarify.y);
    const toEnd = edge('clarify-end');
    expect(toEnd.path.startsWith(`M ${clarify.x + clarify.width} ${clarify.centerY}`)).toBeTrue();
    expect(toEnd.path.endsWith(`${node('end').x} ${node('end').centerY + 20}`)).toBeTrue();
  });

  it('draws the loop as a curve above the row, from Validate back into Analyse', () => {
    const loop = edge('validate-analyse');
    const validate = node('validate');
    const analyse = node('analyse');
    expect(loop.path.startsWith(`M ${validate.x + validate.width / 2} ${validate.y}`)).toBeTrue();
    expect(loop.path).toContain(' C ');
    expect(loop.path.endsWith(`${analyse.x + analyse.width} ${analyse.y + 18}`)).toBeTrue();
    expect(loop.branchLabelY).toBeLessThan(validate.y);
    expect(loop.branchLabelY).toBeGreaterThan(0);
    expect(loop.label).toBe('');
  });

  it('labels the fields passed on the main path only', () => {
    expect(edge('load-catalog-plan').label).toBe('2 fields');
    expect(edge('plan-analyse').label).toBe('1 field');
    expect(edge('plan-clarify').label).toBe('');
    expect(edge('clarify-end').label).toBe('');
  });

  it("End's subtitle is the main path's last step's output", () => {
    expect(node('end').subtitle).toBe('answer');
  });
});

describe('canvas zoom', () => {
  const layout = { width: 1000, height: 500 };

  it('fit picks the largest 5% step that shows the whole canvas, never above 100%', () => {
    expect(fitZoom(layout, 2000, 2000)).toBe(1);
    expect(fitZoom(layout, 1000, 500)).toBe(1);
    expect(fitZoom(layout, 640, 2000)).toBe(0.6);
    expect(fitZoom(layout, 2000, 330)).toBe(0.65);
  });

  it('fit never goes below MIN_ZOOM', () => {
    expect(fitZoom(layout, 100, 100)).toBe(0.4);
    expect(fitZoom(layout, 0, 0)).toBe(0.4);
  });

  it('Questions to Insights v2 fits a 600 px wide canvas at 50%', () => {
    expect(fitZoom(workflowCanvasLayout(V2), 600, 400)).toBe(0.5);
  });

  it('zoom in and out step through the levels and stop at the ends', () => {
    expect(zoomIn(0.4)).toBe(0.5);
    expect(zoomIn(0.6)).toBe(0.75);
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomIn(1.5)).toBe(1.5);
    expect(zoomOut(1.5)).toBe(1.25);
    expect(zoomOut(0.6)).toBe(0.5);
    expect(zoomOut(0.5)).toBe(0.4);
    expect(zoomOut(0.4)).toBe(0.4);
  });
});
