#!/usr/bin/env node
// What each built-in agent receives, read from the compiled backend (the
// agent-change skill; delivery.md, Repo scripts):
//
//   node scripts/agent-inventory.mjs [--root <checkout>] [--json] [--compare <base.json>] [--strict]
//
// For every agent in the registry (backend/src/mastra/index.ts) it loads the
// agent from backend/dist and prints its classes, tools, skills, memory,
// model policy, prompt size and a hash of what the model receives, then the
// tool matrix and the class check (agent-inventory-lib.mjs, AGENT_CLASSES).
//
// - Build first: `npx nest build` in backend/ (the dist is what it reads).
// - --root reads another checkout (the base worktree) with this script:
//     node scripts/agent-inventory.mjs --root <base> --json > .context/agents-base.json
//     node scripts/agent-inventory.mjs --compare .context/agents-base.json
//   The comparison names the agents whose evals must run.
// - Exits 1 for an unclassified or stale class entry; --strict also for a gap.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_CLASSES,
  agentHash,
  checkClasses,
  compareInventories,
  formatComparison,
  formatInventory,
  modelPolicy,
  registryEntries,
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

async function inventory(root) {
  const backend = path.join(root, 'backend');
  const load = createRequire(path.join(backend, 'package.json'));
  const { RequestContext } = load('@mastra/core/request-context');
  const entries = registryEntries(fs.readFileSync(path.join(backend, 'src', 'mastra', 'index.ts'), 'utf8'));
  const agents = compiledAgents(backend, load);
  const records = [];
  for (const { key, ident } of entries) {
    const found = agents.get(ident);
    if (!found) throw new Error(`Registry entry ${key} (${ident}) is not exported by any dist/mastra/agents/*.agent.js`);
    const { agent, source } = found;
    const requestContext = new RequestContext();
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
    const record = {
      key,
      id: agent.id,
      classes: AGENT_CLASSES[key] ?? [],
      instructions,
      tools,
      skills,
      memory: agent.hasOwnMemory(),
      model: modelPolicy(source),
    };
    records.push({ ...record, hash: agentHash(record) });
  }
  return records;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const records = await inventory(options.root);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return 0;
  }
  const check = checkClasses(records);
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
