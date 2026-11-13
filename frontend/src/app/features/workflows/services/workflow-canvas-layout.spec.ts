import {
  WorkflowDetail,
  WorkflowDetailStep,
  WorkflowInputField,
} from '../models/workflow.model';
import {
  CANVAS,
  CanvasBox,
  CanvasLayout,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  canvasBoxes,
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

const MODEL_EXITS: WorkflowDetailStep['exits'] = [
  { label: 'Model error', outcome: 'fails' },
  { label: 'Stop', outcome: 'stops' },
];

const agentStep = (
  id: string,
  tools: string[],
  maxSteps = 15,
): WorkflowDetailStep => ({
  ...code(id, ['question', 'catalog'], ['calls', 'stopped'], MODEL_EXITS),
  title: 'Analyse',
  kind: 'agent',
  agent: {
    name: 'Questions to Insights v2',
    tools,
    maxSteps,
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

/** Questions to Insights v2 before its graph: four steps, the third an agent with three tools. */
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

/**
 * `qti-v2-turn` as `GET /workflows/qti-v2-turn` returns it: Plan and Write
 * answer one model call each, Analyse five tools and three exits, the real
 * field lists (their counts set the gaps).
 */
const REAL_V2: WorkflowDetail = {
  ...GRAPH_WORKFLOW,
  agents: [{ key: 'qti', name: 'Questions to Insights v2', model: 'custom/claude-sonnet-5-5' }],
  input: [field('question'), field('datasets')],
  steps: GRAPH_WORKFLOW.steps.map((step): WorkflowDetailStep => {
    const io: Record<string, [string[], string[]]> = {
      'receive-question': [['question', 'datasets'], ['question', 'datasets']],
      'load-catalog': [['question', 'datasets'], ['question', 'catalog', 'columns']],
      plan: [['question', 'catalog', 'columns'], ['question', 'catalog', 'plan']],
      clarify: [['question', 'catalog', 'plan'], ['question', 'options']],
      analyse: [
        ['question', 'catalog', 'plan', 'attempt', 'findings'],
        ['question', 'catalog', 'plan', 'attempt', 'calls', 'queries', 'text', 'stopped'],
      ],
      validate: [
        ['question', 'catalog', 'plan', 'attempt', 'calls', 'queries', 'text', 'stopped'],
        ['ok', 'attempt', 'findings', 'question', 'catalog', 'plan', 'calls', 'queries'],
      ],
      'write-answer': [
        ['question', 'plan', 'queries', 'findings', 'calls'],
        ['headline', 'answer', 'calls'],
      ],
      'wrap-up': [['answer', 'calls'], ['sqlQueries', 'failedQueries', 'rows', 'answer']],
    };
    const [input, output] = io[step.id];
    if (step.kind !== 'agent') return { ...step, input, output };
    const analyse = step.id === 'analyse';
    return {
      ...step,
      input,
      output,
      agent: {
        ...step.agent!,
        tools: analyse
          ? ['list_entities', 'describe_entity', 'sample_rows', 'run_readonly_sql', 'ask_clarification']
          : [],
        maxSteps: analyse ? 15 : 1,
      },
      exits: analyse
        ? [...MODEL_EXITS, { label: 'Clarifying question', outcome: 'stops' }]
        : MODEL_EXITS,
    };
  }),
};

/** The same, once Clarify suspends the run and goes back to Plan when answered. */
const REAL_V2_CLARIFY_LOOP: WorkflowDetail = {
  ...REAL_V2,
  edges: REAL_V2.edges!
    .filter((e) => !(e.from === 'clarify' && e.to === 'end'))
    .concat([{ from: 'clarify', to: 'plan', kind: 'loop', label: 'Answered' }]),
};

const overlaps = (a: CanvasBox, b: CanvasBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every pair of boxes on the canvas that overlap, as `owner part / owner part`. */
function overlapping(layout: CanvasLayout): string[] {
  const boxes = canvasBoxes(layout);
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) {
        found.push(
          `${boxes[i].owner} ${boxes[i].part} / ${boxes[j].owner} ${boxes[j].part}`,
        );
      }
    }
  }
  return found;
}

describe('workflowCanvasLayout (ui.md 4.4b)', () => {
  it('keeps the contract constants', () => {
    expect(CANVAS).toEqual({
      padding: 20,
      square: 52,
      agentWidth: 120,
      nodeHeight: 88,
      colGap: 44,
      labelWidth: 92,
      labelHeight: 86,
      exitRowHeight: 16,
      exitWidth: 136,
      subSize: 40,
      subTop: 44,
      subLabelWidth: 88,
      toolsLabelWidth: 52,
      subLabelHeight: 52,
      sideGap: 28,
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
      ['trigger', 'start', 20, 20, 52, 52],
      ['code', 'clean', 116, 20, 52, 52],
      ['output', 'end', 212, 20, 52, 52],
    ]);
    expect(layout.nodes.map((n) => n.centerY)).toEqual([46, 46, 46]);
    expect(layout.nodes.map((n) => n.number)).toEqual([null, 1, null]);
    expect(layout.nodes.map((n) => [n.title, n.subtitle])).toEqual([
      ['Start', 'text'],
      ['Title clean', 'clean'],
      ['End', 'text, words'],
    ]);
    // End's label box runs 20 px past it, into the padding.
    expect(layout.width).toBe(212 + 26 + 46 + 4);
    // Start's exit note row sits under its label.
    expect(layout.height).toBe(20 + 52 + 86 + 16 + 20);
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
    expect(layout.nodes.map((n) => n.x)).toEqual([20, 116, 212, 308, 404]);
    expect(new Set(layout.nodes.map((n) => n.y))).toEqual(new Set([20]));
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
    // Start's exit: an invalid input never starts the run. It starts at
    // Start's left edge (Start is the first column).
    expect(layout.nodes[0].exits).toEqual([
      {
        text: 'Invalid input → not started',
        outcome: 'fails',
        x: 20,
        y: 20 + 52 + 86,
        align: 'start',
        width: 184,
        lines: 1,
      },
    ]);
    // A code step's exit sits under its label, centred on the node.
    expect(layout.nodes[2].exits).toEqual([
      {
        text: 'Too long → fails',
        outcome: 'fails',
        x: 212 + 26,
        y: 20 + 52 + 86,
        align: 'center',
        width: 92,
        // Wider than the label box: two rows.
        lines: 2,
      },
    ]);
    expect(layout.height).toBe(20 + 52 + 86 + 2 * 16 + 20);
    expect(overlapping(layout)).toEqual([]);
  });

  it('four steps (Questions to Insights v2): the agent is a wide node, exits above it', () => {
    const layout = workflowCanvasLayout(V2);
    // Two agent exit rows and their gap above the agent; the squares share its centre line.
    const cy = 20 + 2 * 16 + 12 + 44;
    expect(
      layout.nodes.map((n) => [n.id, n.kind, n.x, n.y, n.width, n.height]),
    ).toEqual([
      ['start', 'trigger', 20, cy - 26, 52, 52],
      ['receive-question', 'code', 116, cy - 26, 52, 52],
      ['load-catalog', 'code', 212, cy - 26, 52, 52],
      ['analyse', 'agent', 308, cy - 44, 120, 88],
      ['wrap-up', 'code', 472, cy - 26, 52, 52],
      ['end', 'output', 568, cy - 26, 52, 52],
    ]);
    expect(new Set(layout.nodes.map((n) => n.centerY))).toEqual(new Set([cy]));

    const analyse = layout.nodes[3];
    expect(analyse.agentLine).toBe('Questions to Insights v2 · ≤ 15 steps');
    expect(analyse.exits).toEqual([
      {
        text: 'Model error → fails',
        outcome: 'fails',
        x: 368,
        y: cy - 44 - 12 - 32,
        align: 'center',
        width: 136,
        lines: 1,
      },
      {
        text: 'Stop → ends here',
        outcome: 'stops',
        x: 368,
        y: cy - 44 - 12 - 16,
        align: 'center',
        width: 136,
        lines: 1,
      },
    ]);
    expect(analyse.ports).toEqual([
      { kind: 'model', label: 'Model', x: 308 + 24, y: cy + 44 },
      { kind: 'tool', label: 'Tools', x: 308 + 102, y: cy + 44 },
    ]);
    expect(layout.nodes[0].subtitle).toBe('question, datasets');
    expect(layout.nodes[5].subtitle).toBe('sqlQueries, failedQueries, rows');
    expect(layout.width).toBe(568 + 26 + 46 + 4);
    // Down to the sub-node labels.
    expect(layout.height).toBe(cy + 44 + 44 + 40 + 52 + 20);
    expect(overlapping(layout)).toEqual([]);
  });

  it('hangs the model and one Tools sub-node under the agent, each under its port', () => {
    const layout = workflowCanvasLayout(V2);
    const analyse = layout.nodes[3];
    const subTop = analyse.y + 88 + 44;
    expect(analyse.subNodes).toEqual([
      {
        id: 'analyse-model',
        kind: 'model',
        label: 'claude-sonnet-5-5',
        subtitle: 'model',
        tools: [],
        x: 332 - 20,
        y: subTop,
        size: 40,
      },
      {
        id: 'analyse-tools',
        kind: 'tools',
        label: 'Tools',
        subtitle: '3 tools',
        tools: ['list_entities', 'describe_entity', 'run_readonly_sql'],
        x: 410 - 20,
        y: subTop,
        size: 40,
      },
    ]);
    expect(layout.subEdges.map((e) => [e.id, e.nodeId, e.subNodeId])).toEqual([
      ['analyse-model-edge', 'analyse', 'analyse-model'],
      ['analyse-tools-edge', 'analyse', 'analyse-tools'],
    ]);
    const mid = (analyse.y + 88 + subTop) / 2;
    // Straight down from each port to its sub-node.
    expect(layout.subEdges[0].path).toBe(
      `M 332 ${analyse.y + 88} C 332 ${mid}, 332 ${mid}, 332 ${subTop}`,
    );
    expect(layout.subEdges[1].path.startsWith(`M 410 ${analyse.y + 88} `)).toBe(
      true,
    );
  });

  it('one Tools sub-node however many tools; none without tools; "1 tool"', () => {
    const many = workflowCanvasLayout({
      input: [],
      agents: AGENTS,
      steps: [agentStep('ask', ['t1', 't2', 't3', 't4', 't5', 't6'])],
    });
    expect(
      many.nodes[1].subNodes.map((s) => [s.id, s.kind, s.label, s.subtitle]),
    ).toEqual([
      ['ask-model', 'model', 'claude-sonnet-5-5', 'model'],
      ['ask-tools', 'tools', 'Tools', '6 tools'],
    ]);
    expect(many.subEdges.length).toBe(2);
    const one = workflowCanvasLayout({
      input: [],
      agents: AGENTS,
      steps: [agentStep('ask', ['run_readonly_sql'])],
    });
    expect(one.nodes[1].subNodes[1].subtitle).toBe('1 tool');
    const none = workflowCanvasLayout({
      input: [],
      agents: AGENTS,
      steps: [agentStep('ask', [])],
    });
    expect(none.nodes[1].subNodes.map((s) => s.id)).toEqual(['ask-model']);
    // Both ports stay: the Tools port has nothing hanging from it.
    expect(none.nodes[1].ports.map((p) => p.label)).toEqual(['Model', 'Tools']);
  });

  it('the agent line names the agent, and its step limit only above one step', () => {
    const one = workflowCanvasLayout({
      input: [],
      agents: AGENTS,
      steps: [agentStep('plan', [], 1)],
    });
    expect(one.nodes[1].agentLine).toBe('Questions to Insights v2');
    const many = workflowCanvasLayout({
      input: [],
      agents: AGENTS,
      steps: [agentStep('analyse', [], 2)],
    });
    expect(many.nodes[1].agentLine).toBe('Questions to Insights v2 · ≤ 2 steps');
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
    expect(layout.edges[0].path).toBe(`M 72 ${cy} L 116 ${cy}`);
    expect([layout.edges[0].labelX, layout.edges[0].labelY]).toEqual([
      94,
      cy - 12,
    ]);
    expect(layout.edges[3].path).toBe(`M 428 ${cy} L 472 ${cy}`);

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
    // Below the sub-nodes hanging under the agents, and their labels.
    const subBottom = Math.max(
      ...layout.nodes.flatMap((n) => n.subNodes.map((s) => s.y + s.size + CANVAS.subLabelHeight)),
    );
    expect(clarify.y).toBe(subBottom + CANVAS.sideGap);
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

  it('wraps a wide main-path label onto two lines and widens its gap to fit', () => {
    const valid = edge('validate-write-answer');
    expect(valid.branchLabelLines).toEqual(['Valid or', 'retried']);
    expect(edge('plan-analyse').branchLabelLines).toEqual(['Clear']);
    // Off the main path a label stays on one line.
    expect(edge('plan-clarify').branchLabelLines).toEqual(['Needs clarification']);
    const gap = node('write-answer').x - (node('validate').x + node('validate').width);
    expect(gap).toBeGreaterThan(CANVAS.colGap);
    expect(node('analyse').x - (node('plan').x + node('plan').width)).toBe(CANVAS.colGap);
  });

  it('runs the branch down to Clarify, its label beside the drop, and Clarify on to End', () => {
    const clarify = node('clarify');
    const branch = edge('plan-clarify');
    const gx = clarify.x + clarify.width / 2;
    expect(branch.path.startsWith(`M ${node('plan').x + node('plan').width} ${node('plan').centerY}`)).toBeTrue();
    expect(branch.path.endsWith(`L ${gx} ${clarify.y}`)).toBeTrue();
    expect(branch.branchLabelX).toBeGreaterThan(gx);
    expect(branch.branchLabelY).toBeLessThan(clarify.y);
    expect(branch.branchLabelY).toBeGreaterThan(clarify.y - CANVAS.sideGap);
    const toEnd = edge('clarify-end');
    expect(toEnd.path.startsWith(`M ${clarify.x + clarify.width} ${clarify.centerY}`)).toBeTrue();
    expect(toEnd.path.endsWith(`${node('end').x} ${node('end').centerY + 12}`)).toBeTrue();
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

describe('Questions to Insights v2 as the API returns it (compact canvas)', () => {
  for (const [name, w] of [
    ['Clarify ends the run', REAL_V2],
    ['Clarify goes back to Plan', REAL_V2_CLARIFY_LOOP],
  ] as const) {
    describe(name, () => {
      const layout = workflowCanvasLayout(w);
      const node = (id: string) => layout.nodes.find((n) => n.id === id)!;

      it('fits beside the open right panel at 55% at 1440 × 900, and at 75% or more at 1920 × 1080', () => {
        // The canvas viewport measured with the Run panel open.
        expect(fitZoom(layout, 602, 300)).toBeGreaterThanOrEqual(0.55);
        expect(fitZoom(layout, 1082, 472)).toBeGreaterThanOrEqual(0.75);
      });

      it('overlaps nothing: nodes, labels, exit notes, ports, sub-nodes, edge labels and the Clarify row', () => {
        expect(overlapping(layout)).toEqual([]);
        for (const box of canvasBoxes(layout)) {
          expect(box.x).withContext(`${box.owner} ${box.part}`).toBeGreaterThanOrEqual(0);
          expect(box.y).withContext(`${box.owner} ${box.part}`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).withContext(`${box.owner} ${box.part}`).toBeLessThanOrEqual(layout.width);
          expect(box.y + box.h).withContext(`${box.owner} ${box.part}`).toBeLessThanOrEqual(layout.height);
        }
      });

      it('the drop to Clarify crosses no sub-node, label or exit note', () => {
        const plan = node('plan');
        const clarify = node('clarify');
        const gx = clarify.x + clarify.width / 2;
        const drop: CanvasBox = { owner: 'drop', part: 'node', x: gx - 1, y: plan.y + plan.height, w: 2, h: clarify.y - plan.y - plan.height };
        const crossed = canvasBoxes(layout).filter(
          (b) => b.part !== 'branch-label' && overlaps(drop, b),
        );
        expect(crossed.map((b) => `${b.owner} ${b.part}`)).toEqual([]);
      });

      it("the loop into Analyse enters above the field count of Analyse's edge", () => {
        const analyse = node('analyse');
        const count = canvasBoxes(layout).find(
          (b) => b.owner === 'analyse-validate' && b.part === 'edge-label',
        )!;
        expect(analyse.y + 18).toBeLessThan(count.y);
      });

      it('one Model and one Tools sub-node under Analyse; only the Model under Plan and Write answer, which show the agent name alone', () => {
        expect(node('analyse').subNodes.map((s) => [s.id, s.subtitle])).toEqual([
          ['analyse-model', 'model'],
          ['analyse-tools', '5 tools'],
        ]);
        expect(node('plan').subNodes.map((s) => s.id)).toEqual(['plan-model']);
        expect(node('write-answer').subNodes.map((s) => s.id)).toEqual(['write-answer-model']);
        expect(node('plan').agentLine).toBe('Questions to Insights v2');
        expect(node('write-answer').agentLine).toBe('Questions to Insights v2');
        expect(node('analyse').agentLine).toBe('Questions to Insights v2 · ≤ 15 steps');
        // The long exit wraps; the others take one row.
        expect(node('analyse').exits.map((e) => e.lines)).toEqual([1, 1, 2]);
      });

      it('no sub-node pushes a later column right', () => {
        const validate = node('validate');
        const writeAnswer = node('write-answer');
        const fromValidate = writeAnswer.x - (validate.x + validate.width);
        const plan = node('plan');
        expect(node('analyse').x - (plan.x + plan.width)).toBe(CANVAS.colGap);
        expect(fromValidate).toBeLessThan(CANVAS.colGap * 2);
      });
    });
  }

  describe('Clarify goes back to Plan', () => {
    const layout = workflowCanvasLayout(REAL_V2_CLARIFY_LOOP);
    const node = (id: string) => layout.nodes.find((n) => n.id === id)!;
    const edge = (id: string) => layout.edges.find((e) => e.id === id);

    it('keeps Clarify on the row below, between Plan and Analyse, with no edge to End', () => {
      const clarify = node('clarify');
      expect(clarify.y).toBeGreaterThan(node('plan').y + node('plan').height);
      expect(clarify.x + clarify.width / 2).toBeGreaterThan(node('plan').x + node('plan').width);
      expect(clarify.x + clarify.width / 2).toBeLessThan(node('analyse').x);
      expect(edge('clarify-end')).toBeUndefined();
      expect(node('end').subtitle).toBe('sqlQueries, failedQueries, rows, answer');
    });

    it('draws the way back as a short line up beside the drop, into Plan\'s right side', () => {
      const back = edge('clarify-plan')!;
      const plan = node('plan');
      const clarify = node('clarify');
      const gx = clarify.x + clarify.width / 2;
      const ux = gx - 12;
      const yIn = plan.y + plan.height - 16;
      expect(back.kind).toBe('loop');
      expect(back.label).toBe('');
      expect(back.branchLabelLines).toEqual(['Answered']);
      // A rounded corner, then straight into Plan.
      expect(back.path).toBe(
        `M ${ux} ${clarify.y} L ${ux} ${yIn + 8} Q ${ux} ${yIn} ${ux - 8} ${yIn} L ${plan.x + plan.width} ${yIn}`,
      );
      // Between Plan's right side and the drop, below Plan's handle.
      expect(ux).toBeGreaterThan(plan.x + plan.width);
      expect(ux).toBeLessThan(gx);
      expect(yIn).toBeGreaterThan(plan.centerY);
      // Its label left of the line, the drop's right of it, both above Clarify.
      expect(back.branchLabelX).toBeLessThan(ux);
      expect(edge('plan-clarify')!.branchLabelX).toBeGreaterThan(gx);
      expect(back.branchLabelY).toBe(edge('plan-clarify')!.branchLabelY);
      expect(back.branchLabelY).toBeLessThan(clarify.y);
    });
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

  it('a four-step chain fits a 600 px wide canvas at 90%', () => {
    expect(fitZoom(workflowCanvasLayout(V2), 600, 400)).toBe(0.9);
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
