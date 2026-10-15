import { AgentToolLink } from './agents-api.service';
import { linkedNames } from './prompt-links';

export type NodeKind = 'prompt' | 'skill' | 'tool';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  subtitle: string;
  /** Reaches the model on a real request. */
  active: boolean;
  /** An always-on tool: given to the agent whether or not it is linked. */
  alwaysOn: boolean;
  /** Linked somewhere but does not exist (a deleted skill, an unknown tool). */
  missing: boolean;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'skill' | 'tool';
  active: boolean;
  path: string;
  label: string;
}

export interface FlowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** What the graph is drawn from: the agent's instructions and the libraries. */
export interface FlowGraphInput {
  instructions: string;
  /** The owner's skills, with the tools each body links. */
  skills: { name: string; tools: string[] }[];
  /** Every library tool with its status for this agent. */
  toolLinks: AgentToolLink[];
}

export const NODE_W = 220;
export const NODE_H = 58;
const COL_GAP = 120;
const ROW_GAP = 18;
const PAD = 16;
/** Room above the skills column for instructions -> tool edges, which route over it. */
const BYPASS = 34;

const PROMPT_ID = 'prompt';
const nodeId = (kind: NodeKind, name: string) => `${kind}:${name}`;

/**
 * Lays out the agent's link graph in three columns: instructions -> skills
 * -> tools. Unlinked skills and not-linked tools are only included when
 * `showUnlinked` is set; always-on tools are always there.
 */
export function buildFlowGraph(
  input: FlowGraphInput,
  showUnlinked: boolean,
): FlowGraph {
  const promptSkills = linkedNames(input.instructions, 'skill');
  const promptTools = linkedNames(input.instructions, 'tool');
  const skillsByName = new Map(input.skills.map((s) => [s.name, s]));
  const toolsByName = new Map(input.toolLinks.map((t) => [t.name, t]));

  // Skills: linked ones in instruction order, then (optionally) the rest.
  const skillNames = [
    ...promptSkills,
    ...(showUnlinked
      ? input.skills
          .filter((s) => !promptSkills.includes(s.name))
          .map((s) => s.name)
      : []),
  ];
  const skillActive = (name: string) =>
    promptSkills.includes(name) && skillsByName.has(name);

  const edges: Omit<GraphEdge, 'path'>[] = [];
  for (const name of promptSkills) {
    edges.push({
      id: `${PROMPT_ID}->${nodeId('skill', name)}`,
      from: PROMPT_ID,
      to: nodeId('skill', name),
      kind: 'skill',
      active: skillsByName.has(name),
      label: `The instructions link the ${name} skill`,
    });
  }
  for (const name of promptTools) {
    edges.push({
      id: `${PROMPT_ID}->${nodeId('tool', name)}`,
      from: PROMPT_ID,
      to: nodeId('tool', name),
      kind: 'tool',
      active: toolsByName.has(name),
      label: `The instructions link the ${name} tool`,
    });
  }
  for (const skill of skillNames) {
    for (const tool of skillsByName.get(skill)?.tools ?? []) {
      edges.push({
        id: `${nodeId('skill', skill)}->${nodeId('tool', tool)}`,
        from: nodeId('skill', skill),
        to: nodeId('tool', tool),
        kind: 'tool',
        active: skillActive(skill) && toolsByName.has(tool),
        label: `The ${skill} skill links the ${tool} tool`,
      });
    }
  }

  // Tools: what something shown links to, the always-on ones, and
  // (optionally) the rest of the library.
  const linkedTools = [
    ...new Set(
      edges.filter((e) => e.to.startsWith('tool:')).map((e) => e.to.slice(5)),
    ),
  ];
  const alwaysOn = input.toolLinks
    .filter((t) => t.status === 'always-on')
    .map((t) => t.name);
  const toolNames = [
    ...linkedTools,
    ...alwaysOn.filter((name) => !linkedTools.includes(name)),
    ...(showUnlinked
      ? input.toolLinks
          .map((t) => t.name)
          .filter((name) => !linkedTools.includes(name) && !alwaysOn.includes(name))
      : []),
  ];

  // Vertical placement: columns centred on the tallest one.
  const colHeight = (n: number) => (n ? n * NODE_H + (n - 1) * ROW_GAP : 0);
  const bypass = promptTools.length && skillNames.length ? BYPASS : 0;
  const inner = Math.max(
    colHeight(1),
    colHeight(skillNames.length),
    colHeight(toolNames.length),
  );
  const top = (n: number) => PAD + bypass + (inner - colHeight(n)) / 2;
  const x = (col: number) => PAD + col * (NODE_W + COL_GAP);

  const nodes: GraphNode[] = [
    {
      id: PROMPT_ID,
      kind: 'prompt',
      name: 'Instructions',
      subtitle: 'Sent with the core prompt',
      active: true,
      alwaysOn: false,
      missing: false,
      x: x(0),
      y: top(1),
    },
  ];
  skillNames.forEach((name, i) => {
    const exists = skillsByName.has(name);
    nodes.push({
      id: nodeId('skill', name),
      kind: 'skill',
      name,
      subtitle: !exists
        ? 'Missing skill'
        : skillActive(name)
          ? 'Skill · linked'
          : 'Skill · not linked',
      active: skillActive(name),
      alwaysOn: false,
      missing: !exists,
      x: x(1),
      y: top(skillNames.length) + i * (NODE_H + ROW_GAP),
    });
  });

  // Tools sit at the average height of what links to them, so edges stay short.
  const yOf = new Map(nodes.map((n) => [n.id, n.y]));
  const parentY = (tool: string) => {
    const ys = edges
      .filter((e) => e.to === nodeId('tool', tool))
      .map((e) => yOf.get(e.from) ?? 0);
    return ys.length
      ? ys.reduce((a, b) => a + b, 0) / ys.length
      : Number.MAX_SAFE_INTEGER;
  };
  [...toolNames]
    .sort((a, b) => parentY(a) - parentY(b))
    .forEach((name, i) => {
      const tool = toolsByName.get(name);
      const always = tool?.status === 'always-on';
      const active =
        always || edges.some((e) => e.to === nodeId('tool', name) && e.active);
      nodes.push({
        id: nodeId('tool', name),
        kind: 'tool',
        name,
        subtitle: !tool
          ? 'Missing tool'
          : always
            ? 'Tool · always on'
            : active
              ? 'Tool · linked'
              : 'Tool · not linked',
        active,
        alwaysOn: always,
        missing: !tool,
        x: x(2),
        y: top(toolNames.length) + i * (NODE_H + ROW_GAP),
      });
    });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const skillTop = top(skillNames.length);
  const withPaths: GraphEdge[] = edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      const a = byId.get(e.from)!;
      const b = byId.get(e.to)!;
      const x1 = a.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const skipsColumn =
        a.kind === 'prompt' && b.kind === 'tool' && skillNames.length > 0;
      if (skipsColumn) {
        // Route over the skills column so the edge does not pass through a skill.
        const lane = skillTop - BYPASS / 2;
        return {
          ...e,
          path: `M${x1},${y1} C${x1 + 50},${y1} ${x1 + 40},${lane} ${x1 + 90},${lane} L${x2 - 90},${lane} C${x2 - 40},${lane} ${x2 - 50},${y2} ${x2},${y2}`,
        };
      }
      const dx = (x2 - x1) / 2;
      return {
        ...e,
        path: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
      };
    });

  return {
    nodes,
    edges: withPaths,
    width: x(2) + NODE_W + PAD,
    height: PAD * 2 + bypass + inner,
  };
}

/** Every node on a path through `id` (its ancestors and descendants), for hover highlighting. */
export function connectedTo(graph: FlowGraph, id: string): Set<string> {
  const seen = new Set([id]);
  const walk = (start: string, next: (e: GraphEdge) => [string, string]) => {
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of graph.edges) {
        const [from, to] = next(edge);
        if (from === current && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
  };
  walk(id, (e) => [e.from, e.to]);
  walk(id, (e) => [e.to, e.from]);
  return seen;
}
