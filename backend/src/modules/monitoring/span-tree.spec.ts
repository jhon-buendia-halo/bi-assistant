import { collapseSpans } from './span-collapse';
import { buildTraceTree, IO_MAX, spanKind } from './span-tree';
import {
  flowRows,
  GEN_1,
  GEN_3,
  RUN_1,
  toSpanEventRows,
  TRACE_1,
  TRACE_3,
} from './testing/span-events.fixture';

/** Turn 1's tree from the real-shape export: agent run, memory, model call, requests, tools, framework spans. */

const STEP_1 = '02db36c1c46e4377';
const DESCRIBE = '400c9b500905e642';
const INFERENCE_0 = '01a4130fe46f6d51';

function treeOf(
  traceId: string,
  framework: boolean,
  rows: Record<string, unknown>[] = flowRows(),
) {
  const spans = [...collapseSpans(toSpanEventRows(rows)).values()].filter(
    (s) => s.traceId === traceId,
  );
  return buildTraceTree(traceId, spans, framework);
}

const outline = (tree: ReturnType<typeof treeOf>) =>
  tree.spans.map((s) => `${'  '.repeat(s.depth)}${s.label} [${s.kind}]`);

describe('spanKind', () => {
  it.each([
    ['agent_run', 'agent'],
    ['model_generation', 'model'],
    ['model_step', 'request'],
    ['tool_call', 'tool'],
    ['memory_operation', 'memory'],
    ['skill_action', 'framework'],
    ['processor_run', 'framework'],
    ['workspace_action', 'framework'],
    ['model_inference', 'framework'],
    ['workflow_run', 'other'],
  ])('%s → %s', (type, kind) => {
    expect(spanKind(type)).toBe(kind);
  });
});

describe('buildTraceTree (fixture)', () => {
  it('lists the kept spans depth-first, children by start, framework hidden and counted', () => {
    const tree = treeOf(TRACE_1, false);
    expect(outline(tree)).toEqual([
      'agent run · assistant [agent]',
      '  memory · recall [memory]',
      '  model call · claude-sonnet-5-5 [model]',
      '    request 1 [request]',
      '      describe_entity [tool]',
      '    request 2 [request]',
      '      run_readonly_sql [tool]',
      '    request 3 [request]',
      '      run_readonly_sql [tool]',
      '    request 4 [request]',
      '  memory · save [memory]',
    ]);
    expect(tree.hiddenFramework).toBe(17);
    expect(tree.traceId).toBe(TRACE_1);
    expect(tree.startedAt).toBe('2026-11-10T19:43:43.223Z');
    expect(tree.durationMs).toBe(18310);
  });

  it('shows the framework spans with framework=true', () => {
    const tree = treeOf(TRACE_1, true);
    expect(tree.hiddenFramework).toBe(0);
    expect(tree.spans).toHaveLength(28);
    expect(outline(tree).slice(0, 10)).toEqual([
      'agent run · assistant [agent]',
      '  skill:resolve [framework]',
      '  memory · recall [memory]',
      '  model call · claude-sonnet-5-5 [model]',
      '    request 1 [request]',
      '      workspace:mount:instructions [framework]',
      '      skill:inject [framework]',
      '      input step processor: trailing-assistant-guard [framework]',
      '      describe_entity [tool]',
      '      inference: 0 [framework]',
    ]);
  });

  it('gives each span its offset from the trace start, duration, parent and call link', () => {
    const tree = treeOf(TRACE_1, false);
    const byId = new Map(tree.spans.map((s) => [s.id, s]));
    expect(byId.get(RUN_1)).toMatchObject({
      parentId: null,
      depth: 0,
      type: 'agent_run',
      startMs: 0,
      durationMs: 18310,
      status: 'succeeded',
      callId: null,
      details: [{ label: 'Agent', value: 'Questions to Insights Assistant' }],
    });
    expect(byId.get(GEN_1)).toMatchObject({
      parentId: RUN_1,
      startMs: 26,
      durationMs: 18261,
      callId: GEN_1,
      input: null,
    });
    expect(byId.get(STEP_1)).toMatchObject({
      parentId: GEN_1,
      depth: 2,
      startMs: 34,
      durationMs: 3543,
      callId: GEN_1,
      output: "I'll start by checking how goals and matches are structured.",
    });
    expect(byId.get(DESCRIBE)).toMatchObject({
      parentId: STEP_1,
      startMs: 3566,
      durationMs: 3,
      callId: null,
    });
  });

  it('describes a model call, a request, a tool and a memory operation', () => {
    const byId = new Map(treeOf(TRACE_1, false).spans.map((s) => [s.id, s]));
    expect(byId.get(GEN_1)!.details).toEqual([
      { label: 'Model', value: 'claude-sonnet-5-5' },
      { label: 'Provider', value: 'anthropic.messages' },
      { label: 'Tokens', value: '61,185 in / 2,445 out' },
      { label: 'Cache', value: 'read 43,532 · write 17,645' },
      { label: 'Cost', value: '$0.0729' },
      { label: 'Finish reason', value: 'stop' },
    ]);
    expect(byId.get(STEP_1)!.details).toEqual([
      { label: 'Model', value: 'claude-sonnet-5-5' },
      { label: 'Tokens', value: '12,320 in / 409 out' },
      { label: 'Cache', value: 'read 0 · write 12,318' },
      { label: 'Finish reason', value: 'tool-calls' },
    ]);
    const sql = byId.get('0bda1902cd4ae3ec')!;
    expect(sql.details).toEqual([
      {
        label: 'Tool input',
        value:
          'SELECT t.id, t.name, MIN(m.kicked_off_at) AS first_match, MAX(m.kicked_off_at) A…',
      },
      { label: 'Rows', value: '2' },
    ]);
    expect(JSON.parse(sql.input!)).toMatchObject({
      datasourceId: '665abcef-c67f-4f14-9d97-eb19a3decf5b',
    });
    expect(JSON.parse(sql.output!)).toMatchObject({ columns: ['id', 'name'] });
    const recall = byId.get('e5e7e2e8239bf590')!;
    expect(recall.details).toEqual([{ label: 'Operation', value: 'recall' }]);
    expect(recall.input).toBeNull();
    expect(recall.output).toBeNull();
  });

  it("hangs a hidden framework span's children from the nearest kept ancestor", () => {
    const rows = flowRows().map((r) =>
      r.spanId === DESCRIBE ? { ...r, parentSpanId: INFERENCE_0 } : r,
    );
    const hidden = treeOf(TRACE_1, false, rows).spans.find(
      (s) => s.id === DESCRIBE,
    )!;
    expect(hidden.parentId).toBe(STEP_1);
    expect(hidden.depth).toBe(3);
    const shown = treeOf(TRACE_1, true, rows).spans.find(
      (s) => s.id === DESCRIBE,
    )!;
    expect(shown.parentId).toBe(INFERENCE_0);
    expect(shown.depth).toBe(4);
  });

  it('never shows model_chunk spans', () => {
    const rows = flowRows();
    const inference = rows.find(
      (r) => r.spanId === INFERENCE_0 && r.eventType === 'end',
    )!;
    rows.push({
      ...inference,
      spanId: 'chunk-0000000001',
      parentSpanId: INFERENCE_0,
      name: "chunk: 'text-delta'",
      spanType: 'model_chunk',
      cursorId: undefined,
    });
    for (const framework of [false, true]) {
      const tree = treeOf(TRACE_1, framework, rows);
      expect(tree.spans.some((s) => s.type === 'model_chunk')).toBe(false);
    }
    expect(treeOf(TRACE_1, false, rows).hiddenFramework).toBe(17);
  });

  it('marks a failed tool with its error', () => {
    const rows = flowRows().map((r) =>
      r.spanId === DESCRIBE && r.eventType === 'end'
        ? { ...r, error: { message: 'Entity not found' } }
        : r,
    );
    const tool = treeOf(TRACE_1, false, rows).spans.find(
      (s) => s.id === DESCRIBE,
    )!;
    expect(tool.status).toBe('failed');
    expect(tool.details).toContainEqual({
      label: 'Error',
      value: 'Entity not found',
    });
  });

  it(`cuts a long input or output to ${IO_MAX} chars`, () => {
    const rows = flowRows().map((r) =>
      r.spanId === DESCRIBE && r.eventType === 'end'
        ? { ...r, output: { text: 'y'.repeat(9000) } }
        : r,
    );
    const tool = treeOf(TRACE_1, false, rows).spans.find(
      (s) => s.id === DESCRIBE,
    )!;
    expect(tool.output).toHaveLength(IO_MAX);
  });

  it('shows a running turn: no end, no duration', () => {
    const tree = treeOf(TRACE_3, false);
    expect(tree.durationMs).toBeNull();
    expect(outline(tree)).toEqual([
      'agent run · assistant [agent]',
      '  memory · recall [memory]',
      '  model call · claude-sonnet-5-5 [model]',
      '    request 1 [request]',
    ]);
    const generation = tree.spans.find((s) => s.id === GEN_3)!;
    expect(generation.status).toBe('running');
    expect(generation.durationMs).toBeNull();
    expect(tree.spans.every((s) => s.status === 'running')).toBe(true);
  });
});
