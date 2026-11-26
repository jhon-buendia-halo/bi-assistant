// Pure logic of scripts/agent-inventory.mjs (delivery.md, Repo scripts): read
// the registry, check each agent's tools against its declared classes, hash
// what the model receives, compare two inventories, format the report. No
// I/O here, so `node --test scripts/agent-inventory-lib.test.mjs` covers it.
import { createHash } from 'node:crypto';

/**
 * What each built-in agent is, by registry key (the agent-change skill,
 * "Classify the agent"). An agent may be more than one:
 * - `person`: a person talks to it (a chat, a run, a bound session);
 * - `data`: it answers from the session's datasets;
 * - `orchestrator`: it calls other agents as its tools;
 * - `single-step`: the code calls it once with a contract; no person, no tools.
 * A registered agent missing here fails the inventory: classify it.
 */
export const AGENT_CLASSES = {
  assistant: ['person', 'data'],
  'insights-analyst': ['person', 'data'],
  'insights-lead': ['person', 'data'],
  'data-readiness': ['person', 'data'],
  'chief-of-staff': ['person', 'orchestrator'],
  'bi-analyst': ['data'],
  visualization: ['single-step'],
  'sql-fixer': ['single-step'],
  'sql-verifier': ['single-step'],
  'assistant-eval-judge': ['single-step'],
  'knowledge-bootstrap': ['single-step'],
  'analysis-planner': ['single-step'],
  'answer-writer': ['single-step'],
  'requirements-analyst': ['single-step'],
  'layer-mapper': ['single-step'],
  'gap-advisor': ['single-step'],
  'query-explainer': ['single-step'],
  'result-explorer': ['single-step'],
};

/** The tools every `data` agent has: its answers reach the query inspector through them. */
export const DATA_KIT = [
  'list_entities',
  'describe_entity',
  'run_readonly_sql',
  'explore_result',
];

/** The tool every `person` agent has. */
export const PERSON_TOOL = 'ask_clarification';

/**
 * `{ key, ident }` for each `key: identifier` entry of the `agents: { … }`
 * block in backend/src/mastra/index.ts, in order. Throws when there is none.
 */
export function registryEntries(indexSource) {
  const block = /\n\s*agents:\s*\{([\s\S]*?)\n\s*\},/.exec(indexSource);
  if (!block) throw new Error('No `agents: { … }` block in mastra/index.ts');
  const entries = [];
  for (const line of block[1].split('\n')) {
    const match = /^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(line);
    if (match) entries.push({ key: match[1] ?? match[2], ident: match[3] });
  }
  if (!entries.length) throw new Error('The `agents` block of mastra/index.ts lists no agent');
  return entries;
}

/** How an agent's source picks its model. */
export function modelPolicy(source) {
  if (source.includes('modelOverrideFrom(')) return 'user-override';
  if (source.includes('resolveVisualizationModel(')) return 'designer';
  if (source.includes('stepModelFrom(')) return 'step-model';
  return 'saved';
}

/**
 * A short, stable hash of what the model receives: the instructions, each
 * tool's name, description and input schema, and each skill's name and
 * description. Equal hashes on base and branch mean the evals need not run.
 */
export function agentHash({ instructions, tools, skills }) {
  const payload = JSON.stringify({
    instructions,
    tools: [...tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, description, input }) => ({ name, description, input })),
    skills: [...skills]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, description }) => ({ name, description })),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

/** What one agent misses for its classes, as sentences. */
export function classGaps(record) {
  const names = new Set(record.tools.map((tool) => tool.name));
  const gaps = [];
  for (const kind of record.classes) {
    if (kind === 'person' && !names.has(PERSON_TOOL)) {
      gaps.push(`talks to a person but has no ${PERSON_TOOL}`);
    }
    if (kind === 'data') {
      const missing = DATA_KIT.filter((name) => !names.has(name));
      if (missing.length) gaps.push(`answers from data but misses ${missing.join(', ')}`);
    }
    if (kind === 'single-step' && names.size) {
      gaps.push(`is single-step but has tools: ${[...names].join(', ')}`);
    }
  }
  return gaps;
}

/**
 * The class check over every agent: registered agents with no class
 * (`unclassified`), classes for agents no longer registered (`stale`), and
 * each agent's gaps.
 */
export function checkClasses(records, classes = AGENT_CLASSES) {
  const keys = new Set(records.map((record) => record.key));
  return {
    unclassified: records.filter((record) => !classes[record.key]).map((record) => record.key),
    stale: Object.keys(classes).filter((key) => !keys.has(key)),
    gaps: records
      .filter((record) => record.classes.length)
      .flatMap((record) => classGaps(record).map((gap) => ({ key: record.key, gap }))),
  };
}

/** What differs between a base inventory and this one. */
export function compareInventories(base, branch) {
  const before = new Map(base.map((record) => [record.key, record]));
  const after = new Map(branch.map((record) => [record.key, record]));
  const changed = [];
  for (const [key, record] of after) {
    const old = before.get(key);
    if (!old || old.hash === record.hash) continue;
    const what = [];
    if (old.instructions !== record.instructions) {
      what.push(`instructions ${old.instructions.length} → ${record.instructions.length} chars`);
    }
    const oldTools = old.tools.map((tool) => tool.name);
    const newTools = record.tools.map((tool) => tool.name);
    const added = newTools.filter((name) => !oldTools.includes(name));
    const removed = oldTools.filter((name) => !newTools.includes(name));
    if (added.length) what.push(`tools + ${added.join(', ')}`);
    if (removed.length) what.push(`tools − ${removed.join(', ')}`);
    if (!added.length && !removed.length && JSON.stringify(old.tools) !== JSON.stringify(record.tools)) {
      what.push('a tool description or schema');
    }
    if (JSON.stringify(old.skills) !== JSON.stringify(record.skills)) what.push('skills');
    changed.push({ key, what: what.length ? what : ['content'] });
  }
  return {
    added: [...after.keys()].filter((key) => !before.has(key)),
    removed: [...before.keys()].filter((key) => !after.has(key)),
    changed,
  };
}

function table(header, rows) {
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => String(row[i]).length)));
  const line = (cells) => `| ${cells.map((cell, i) => String(cell).padEnd(widths[i])).join(' | ')} |`;
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

/** The tool names in report order: the data kit, the person tool, then the rest A→Z. */
function toolOrder(records) {
  const all = new Set(records.flatMap((record) => record.tools.map((tool) => tool.name)));
  const first = [...DATA_KIT, 'sample_rows', PERSON_TOOL].filter((name) => all.has(name));
  return [...first, ...[...all].filter((name) => !first.includes(name)).sort()];
}

/** The report: agents, the tool matrix of the agents with tools, the class check. */
export function formatInventory(records, check) {
  const out = ['## Agents', ''];
  out.push(
    table(
      ['key', 'classes', 'tools', 'skills', 'memory', 'model', 'prompt chars', 'hash'],
      records.map((record) => [
        record.key,
        record.classes.join(', ') || '(unclassified)',
        record.tools.length,
        record.skills.map((skill) => skill.name).join(', ') || '-',
        record.memory ? 'yes' : '-',
        record.model,
        record.instructions.length,
        record.hash,
      ]),
    ),
  );
  const withTools = records.filter((record) => record.tools.length);
  if (withTools.length) {
    out.push('', '## Tools of the agents that have tools', '');
    out.push(
      table(
        ['tool', ...withTools.map((record) => record.key)],
        toolOrder(withTools).map((name) => [
          name,
          ...withTools.map((record) => (record.tools.some((tool) => tool.name === name) ? '✓' : '')),
        ]),
      ),
    );
  }
  out.push('', '## Class check', '');
  for (const key of check.unclassified) out.push(`- ERROR ${key}: not in AGENT_CLASSES (scripts/agent-inventory-lib.mjs); classify it`);
  for (const key of check.stale) out.push(`- ERROR ${key}: in AGENT_CLASSES but no longer registered; remove it`);
  for (const { key, gap } of check.gaps) out.push(`- gap ${key}: ${gap}`);
  if (!check.unclassified.length && !check.stale.length && !check.gaps.length) out.push('- every agent has the tools of its classes');
  out.push(
    '',
    'Read without a run: no prompt or skill overrides and no runtime bridges, so instructions are the shipped text, tools are the full set a call can get, and skills are those that need no bridge.',
  );
  return out.join('\n');
}

/** The comparison report, ending with the agents whose evals must run. */
export function formatComparison(diff) {
  const out = ['## Compared with the base', ''];
  for (const key of diff.added) out.push(`- added ${key}`);
  for (const key of diff.removed) out.push(`- removed ${key}`);
  for (const { key, what } of diff.changed) out.push(`- changed ${key}: ${what.join('; ')}`);
  const evals = [...diff.added, ...diff.changed.map((entry) => entry.key)];
  out.push(
    '',
    evals.length
      ? `Evals to run (base against branch): ${evals.join(', ')}`
      : 'Every hash is equal: no agent receives anything new, the evals need not run.',
  );
  return out.join('\n');
}
