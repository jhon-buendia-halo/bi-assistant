#!/usr/bin/env node
// What each built-in agent receives, read from the compiled backend (the
// agent-change skill; delivery.md, Repo scripts):
//
//   node scripts/agent-inventory.mjs [--root <checkout>] [--json] [--compare <base.json>] [--strict]
//
// For every agent in the registry (backend/src/mastra/index.ts) it loads the
// agent from backend/dist and prints its classes, tools, skills, memory,
// model policy, prompt size and a hash of what the model receives, then the
// tool matrix and the class check (each agent's `classes`, declared in its
// defineBuiltinAgent spec and read from the build).
//
// - Build first: `npx nest build` in backend/ (the dist is what it reads).
// - --root reads another checkout (the base worktree) with this script:
//     node scripts/agent-inventory.mjs --root <base> --json > .context/agents-base.json
//     node scripts/agent-inventory.mjs --compare .context/agents-base.json
//   The comparison names the agents whose evals must run, and the matrix
//   scenarios each one differs under (a base recorded by an older script has
//   no per-scenario hashes: record it again with --root).
// - Exits 1 for an unclassified or stale class entry; --strict also for a gap.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentHash,
  checkClasses,
  compareInventories,
  formatComparison,
  formatInventory,
  matrixHash,
  matrixOverridePrompt,
  MATRIX_SCENARIOS,
  modelPolicy,
  registryEntries,
  scenarioHashes,
} from './agent-inventory-lib.mjs';

const USAGE = 'Usage: node scripts/agent-inventory.mjs [--root <checkout>] [--json] [--compare <base.json>] [--strict]';

function parseArgs(argv) {
  const options = { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), json: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--root' || arg === '--compare') {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} needs a value. ${USAGE}`);
      options[arg.slice(2)] = path.resolve(value);
      i += 1;
    } else throw new Error(`Unknown option ${arg}. ${USAGE}`);
  }
  return options;
}

/** Every exported Agent of the compiled agent modules, by export name, with its source. */
function compiledAgents(backend, load) {
  const distDir = path.join(backend, 'dist', 'mastra', 'agents');
  if (!fs.existsSync(distDir)) throw new Error(`No ${distDir}: run \`npx nest build\` in ${backend} first`);
  const byIdent = new Map();
  for (const file of fs.readdirSync(distDir).filter((name) => name.endsWith('.agent.js'))) {
    const mod = load(path.join(distDir, file));
    const source = fs.readFileSync(path.join(backend, 'src', 'mastra', 'agents', file.replace(/\.js$/, '.ts')), 'utf8');
    for (const [ident, value] of Object.entries(mod)) {
      if (value && typeof value.getInstructions === 'function' && typeof value.listTools === 'function') {
        byIdent.set(ident, { agent: value, source });
      }
    }
  }
  return byIdent;
}

function inputSchema(tool) {
  try {
    return tool.inputSchema?.toJSONSchema?.() ?? null;
  } catch {
    return null;
  }
}

/** What the model receives from an agent under one request context. */
async function readAgent(agent, requestContext) {
  const raw = await agent.getInstructions({ requestContext });
  const instructions = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const tools = Object.entries(await agent.listTools({ requestContext })).map(([name, tool]) => ({
    name,
    description: tool.description ?? '',
    input: inputSchema(tool),
  }));
  let skills = [];
  try {
    skills = (await agent.listSkills({ requestContext })).map(({ name, description }) => ({ name, description: description ?? '' }));
  } catch {
    // A skill source that needs a runtime bridge: none without a run.
  }
  return { instructions, tools, skills };
}

/** The model an agent's model function picks, through the echoing resolver. */
async function readModel(agent, requestContext) {
  try {
    return typeof agent.model === 'function' ? await agent.model({ requestContext }) : agent.model;
  } catch (error) {
    return `ERR ${error.message}`;
  }
}

/**
 * Each agent's outputs across MATRIX_SCENARIOS, hashed: `{ matrixHash,
 * scenarioHashes }`, the second one hash per scenario so a comparison can
 * name the scenarios that differ. The compiled build's
 * own bridges are used: an echoing model resolver (the model it is asked for
 * comes back as plain data) and, for `overrides`, a prompt override per agent.
 */
async function matrixHashes(backend, load, RequestContext, found) {
  const dist = (file) => load(path.join(backend, 'dist', 'mastra', file));
  const { setAgentModelResolver } = dist('model-resolver.js');
  const { setAgentPromptOverrides } = dist('agent-prompt-overrides.js');
  setAgentModelResolver(async (override) => ({ id: `openai/${override ?? 'saved-model'}`, apiKey: 'matrix' }));
  const outputs = new Map(found.map(({ key }) => [key, []]));
  for (const scenario of [{ name: 'empty', context: {} }, ...MATRIX_SCENARIOS]) {
    setAgentPromptOverrides(
      scenario.overrides
        ? found.map(({ key }) => ({ key, prompt: matrixOverridePrompt(key), baseHash: 'matrix' }))
        : [],
    );
    for (const { key, agent } of found) {
      const requestContext = new RequestContext();
      for (const [name, value] of Object.entries(scenario.context)) requestContext.set(name, value);
      let read;
      try {
        read = await readAgent(agent, requestContext);
      } catch (error) {
        read = `ERR ${error.message}`;
      }
      outputs.get(key).push({ scenario: scenario.name, read, model: await readModel(agent, requestContext) });
    }
  }
  setAgentPromptOverrides([]);
  return new Map(
    [...outputs].map(([key, list]) => [key, { matrixHash: matrixHash(list), scenarioHashes: scenarioHashes(list) }]),
  );
}

/**
 * Each built agent's declared classes, by key, from the build's factory
 * (loaded after the agents, which register themselves). An older checkout
 * without the factory declares none.
 */
function declaredClasses(backend, load) {
  const factory = path.join(backend, 'dist', 'mastra', 'agent-factory.js');
  return fs.existsSync(factory) ? load(factory).builtinAgentClasses() : {};
}

async function inventory(root) {
  const backend = path.join(root, 'backend');
  const load = createRequire(path.join(backend, 'package.json'));
  const { RequestContext } = load('@mastra/core/request-context');
  const entries = registryEntries(fs.readFileSync(path.join(backend, 'src', 'mastra', 'index.ts'), 'utf8'));
  const agents = compiledAgents(backend, load);
  const records = [];
  const declared = declaredClasses(backend, load);
  const found = entries.map(({ key, ident }) => {
    const hit = agents.get(ident);
    if (!hit) throw new Error(`Registry entry ${key} (${ident}) is not exported by any dist/mastra/agents/*.agent.js`);
    return { key, ...hit };
  });
  for (const { key, agent, source } of found) {
    const { instructions, tools, skills } = await readAgent(agent, new RequestContext());
    const record = {
      key,
      id: agent.id,
      classes: declared[key] ?? [],
      instructions,
      tools,
      skills,
      memory: agent.hasOwnMemory(),
      model: modelPolicy(source),
    };
    records.push({ ...record, hash: agentHash(record) });
  }
  const matrix = await matrixHashes(backend, load, RequestContext, found);
  return {
    records: records.map((record) => ({ ...record, ...matrix.get(record.key) })),
    declared,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { records, declared } = await inventory(options.root);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return 0;
  }
  const check = checkClasses(records, declared);
  const report = [formatInventory(records, check)];
  if (options.compare) {
    const base = JSON.parse(fs.readFileSync(options.compare, 'utf8'));
    report.push('', formatComparison(compareInventories(base, records)));
  }
  console.log(report.join('\n'));
  const errors = check.unclassified.length + check.stale.length;
  return errors || (options.strict && check.gaps.length) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error.message);
    process.exit(2);
  },
);
