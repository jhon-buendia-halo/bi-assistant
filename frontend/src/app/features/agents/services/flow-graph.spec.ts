import { AgentToolLink, ToolLinkStatus } from './agents-api.service';
import { FlowGraphInput, buildFlowGraph, connectedTo } from './flow-graph';

const tool = (name: string, status: ToolLinkStatus): AgentToolLink => ({
  name,
  status,
  linkedVia: { instructions: false, skills: [] },
});

const input: FlowGraphInput = {
  instructions:
    'Use [[skill:planner]], [[skill:gone]] and [[tool:sample_rows]].',
  skills: [
    { name: 'planner', tools: ['create_visual'] },
    { name: 'unused', tools: ['update_visual'] },
  ],
  toolLinks: [
    tool('create_visual', 'linked'),
    tool('describe_entity', 'always-on'),
    tool('sample_rows', 'linked'),
    tool('update_visual', 'not-linked'),
    tool('ask_clarification', 'not-linked'),
  ],
};

describe('buildFlowGraph', () => {
  it('links instructions to skills to tools and flags missing skills', () => {
    const graph = buildFlowGraph(input, false);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    expect(graph.nodes.map((n) => n.id)).toEqual([
      'prompt',
      'skill:planner',
      'skill:gone',
      // Tools sit level with their parents to avoid crossings; the always-on
      // tool has nothing linking it, so it goes last.
      'tool:create_visual',
      'tool:sample_rows',
      'tool:describe_entity',
    ]);
    expect(graph.edges.map((e) => [e.from, e.to, e.active])).toEqual([
      ['prompt', 'skill:planner', true],
      ['prompt', 'skill:gone', false],
      ['prompt', 'tool:sample_rows', true],
      ['skill:planner', 'tool:create_visual', true],
    ]);
    expect(byId.get('skill:gone')).toEqual(
      jasmine.objectContaining({ missing: true, active: false }),
    );
    expect(byId.get('tool:describe_entity')).toEqual(
      jasmine.objectContaining({ alwaysOn: true, active: true }),
    );
    // Columns: instructions, then skills, then tools.
    expect(new Set(graph.nodes.map((n) => n.x)).size).toBe(3);
  });

  it('shows unlinked skills and not-linked tools as inactive when asked', () => {
    const graph = buildFlowGraph(input, true);
    const inactive = graph.nodes.filter((n) => !n.active).map((n) => n.id);
    expect(inactive).toEqual([
      'skill:gone',
      'skill:unused',
      'tool:update_visual',
      'tool:ask_clarification',
    ]);
    expect(graph.edges.find((e) => e.from === 'skill:unused')).toEqual(
      jasmine.objectContaining({ to: 'tool:update_visual', active: false }),
    );
  });

  it('routes instructions to tool edges over the skills column', () => {
    const graph = buildFlowGraph(input, false);
    const direct = graph.edges.find(
      (e) => e.id === 'prompt->tool:sample_rows',
    )!;
    const viaSkill = graph.edges.find(
      (e) => e.id === 'skill:planner->tool:create_visual',
    )!;
    expect(direct.path).toContain(' L');
    expect(viaSkill.path).not.toContain(' L');
  });

  it('traces the ancestors and descendants of a node', () => {
    const graph = buildFlowGraph(input, false);
    expect([...connectedTo(graph, 'skill:planner')].sort()).toEqual([
      'prompt',
      'skill:planner',
      'tool:create_visual',
    ]);
  });

  it('draws only the instructions and the always-on tools when nothing is linked', () => {
    const graph = buildFlowGraph(
      { ...input, instructions: 'Be brief.' },
      false,
    );
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'prompt',
      'tool:describe_entity',
    ]);
    expect(graph.edges).toEqual([]);
  });
});
