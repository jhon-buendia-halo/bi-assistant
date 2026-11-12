import { AgentWorkflowStep } from '../../agents/services/agents-api.service';
import {
  CANVAS,
  fitZoom,
  workflowCanvasLayout,
  zoomIn,
  zoomOut,
} from './workflow-canvas-layout';

const code = (
  id: string,
  input: string[],
  output: string[],
  exits: AgentWorkflowStep['exits'] = [],
): AgentWorkflowStep => ({
  id,
  title: id,
  kind: 'code',
  summary: `${id} summary`,
  input,
  output,
  exits,
});

const agentStep = (id: string): AgentWorkflowStep => ({
  ...code(id, ['question', 'catalog'], ['calls', 'stopped'], [
    { label: 'Model error', outcome: 'fails' },
    { label: 'Stop', outcome: 'stops' },
  ]),
  kind: 'agent',
  agent: { name: 'Questions to Insights v2', tools: ['run_readonly_sql'], maxSteps: 15 },
});

/** The graph's centre line. */
const CX = 24 + 280 / 2;

describe('workflowCanvasLayout (ui.md 4.4b)', () => {
  it('keeps the drawing constants of the designer', () => {
    expect(CANVAS.nodeWidth).toBe(280);
    expect(CANVAS.nodeHeight).toBe(64);
    expect(CANVAS.terminalSize).toBe(48);
  });

  it('lays out one step: Start, the step and End down the centre line', () => {
    const layout = workflowCanvasLayout([code('answer', ['message'], ['answer'])]);
    expect(layout.width).toBe(508);
    expect(layout.height).toBe(344);
    expect(
      layout.nodes.map((n) => [n.kind, n.id, n.x, n.y, n.width, n.height]),
    ).toEqual([
      ['start', 'start', CX - 24, 56, 48, 48],
      ['step', 'answer', 24, 152, 280, 64],
      ['end', 'end', CX - 24, 264, 48, 48],
    ]);
    expect(layout.nodes[1].number).toBe(1);
    expect(layout.connectors).toEqual([
      {
        id: 'start-answer',
        x: CX,
        y1: 104,
        y2: 152,
        path: `M ${CX} 104 V 152`,
        label: 'message',
        labelX: CX + 10,
        labelY: 128,
      },
      {
        id: 'answer-end',
        x: CX,
        y1: 216,
        y2: 264,
        path: `M ${CX} 216 V 264`,
        label: 'answer',
        labelX: CX + 10,
        labelY: 240,
      },
    ]);
  });

  it('lays out three steps: each connector carries what the step above passes on', () => {
    const layout = workflowCanvasLayout([
      code('clean-text', ['text'], ['text'], [{ label: 'Empty text', outcome: 'fails' }]),
      code('count-words', ['text'], ['text', 'words', 'characters']),
      code('format-result', ['text', 'words', 'characters'], ['summary']),
    ]);
    expect(layout.width).toBe(508);
    expect(layout.height).toBe(568);
    expect(layout.nodes.map((n) => [n.id, n.y, n.height])).toEqual([
      ['start', 56, 48],
      ['clean-text', 152, 64],
      ['count-words', 264, 64],
      ['format-result', 376, 64],
      ['end', 488, 48],
    ]);
    expect(layout.connectors.map((c) => [c.id, c.y1, c.y2, c.label])).toEqual([
      ['start-clean-text', 104, 152, 'text'],
      ['clean-text-count-words', 216, 264, 'text'],
      ['count-words-format-result', 328, 376, 'text, words, characters'],
      ['format-result-end', 440, 488, 'summary'],
    ]);
    expect(layout.nodes[1].exits).toEqual([
      { text: 'Empty text → fails', outcome: 'fails', x: 314, y: 176 },
    ]);
    expect(layout.nodes[2].exits).toEqual([]);
  });

  it('lays out four steps with a taller agent step and its exits stacked at its right edge', () => {
    const layout = workflowCanvasLayout([
      code('receive-question', ['question', 'datasets'], ['question', 'datasets']),
      code('load-catalog', ['question', 'datasets'], ['question', 'catalog']),
      agentStep('analyse'),
      code('wrap-up', ['calls', 'stopped'], ['sqlQueries', 'failedQueries', 'rows']),
    ]);
    expect(layout.width).toBe(508);
    expect(layout.height).toBe(700);
    expect(layout.nodes.map((n) => [n.id, n.number, n.y, n.height])).toEqual([
      ['start', null, 56, 48],
      ['receive-question', 1, 152, 64],
      ['load-catalog', 2, 264, 64],
      ['analyse', 3, 376, 84],
      ['wrap-up', 4, 508, 64],
      ['end', null, 620, 48],
    ]);
    expect(layout.connectors.map((c) => [c.y1, c.y2, c.label])).toEqual([
      [104, 152, 'question, datasets'],
      [216, 264, 'question, datasets'],
      [328, 376, 'question, catalog'],
      [460, 508, 'calls, stopped'],
      [572, 620, 'sqlQueries, failedQueries, rows'],
    ]);
    // Two exits: 16 px rows centred on the 84 px node.
    expect(layout.nodes[3].exits).toEqual([
      { text: 'Model error → fails', outcome: 'fails', x: 314, y: 402 },
      { text: 'Stop → ends here', outcome: 'stops', x: 314, y: 418 },
    ]);
    // Every connector runs down the same centre line, node to node.
    for (const c of layout.connectors) expect(c.x).toBe(CX);
  });

  it('never lets a node run past the canvas', () => {
    const layout = workflowCanvasLayout([agentStep('a'), code('b', [], [])]);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe('fitZoom and the zoom steps (ui.md 4.4b)', () => {
  const layout = { width: 508, height: 700 };

  it('fits at 100% when the canvas has the room, never above 150%', () => {
    expect(fitZoom(layout, 960, 1400)).toBe(1.5);
    expect(fitZoom(layout, 960, 700)).toBe(1);
  });

  it('shrinks to the tighter side, down to 75% and no further', () => {
    expect(fitZoom(layout, 554, 630)).toBe(0.9);
    // In steps of 5%: 695 / 700 is 99%, shown as 95%.
    expect(fitZoom(layout, 602, 695)).toBe(0.95);
    expect(fitZoom(layout, 300, 300)).toBe(0.75);
  });

  it('steps 75% → 100% → 125% → 150% and back, from any fitted level', () => {
    expect(zoomIn(0.75)).toBe(1);
    expect(zoomIn(0.9)).toBe(1);
    expect(zoomIn(1.5)).toBe(1.5);
    expect(zoomOut(1.25)).toBe(1);
    expect(zoomOut(0.9)).toBe(0.75);
    expect(zoomOut(0.75)).toBe(0.75);
  });
});
