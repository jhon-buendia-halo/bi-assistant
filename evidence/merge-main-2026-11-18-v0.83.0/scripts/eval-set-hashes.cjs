// Hashes what each eval set's target runs. Usage: node eval-set-hashes.cjs <dist> [--full]
// Components per set: agents (instructions + tools, per agent), steps (prompt
// modules/exports, functions by fn.toString()), hooks (target orientation source).
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dist = path.resolve(process.argv[2]);
process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhash-'));
const m = (p) => require(path.join(dist, p));
const { z } = require(require.resolve('zod', { paths: [dist] }));
const { RequestContext } = require(require.resolve('@mastra/core/request-context', { paths: [dist] }));

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (t) =>
  String(t)
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, '<DATE>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<UUID>');

function canon(v) {
  if (typeof v === 'function') return { fn: v.toString() };
  if (v && typeof v === 'object' && v._zod) {
    try { return { zod: z.toJSONSchema(v) }; } catch { return { zod: String(v._zod.def && v._zod.def.type) }; }
  }
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
}
const ser = (v) => JSON.stringify(canon(v));

function schemaOf(tool) {
  const s = tool.inputSchema;
  if (!s) return null;
  try { return z.toJSONSchema(s); } catch {}
  try { return s['~standard'] ? JSON.parse(JSON.stringify(s)) : String(s); } catch { return String(s); }
}

async function agentPart(agent) {
  const rc = new RequestContext();
  const instr = await agent.getInstructions({ requestContext: rc });
  const text = typeof instr === 'string' ? instr : JSON.stringify(instr);
  let tools = {};
  try { tools = (await (agent.listTools ? agent.listTools({ requestContext: rc }) : agent.getTools({ requestContext: rc }))) || {}; } catch (e) { tools = { __error: { description: String(e) } }; }
  const toolList = Object.keys(tools).sort().map((n) => ({
    name: n, description: tools[n].description ?? null, input: schemaOf(tools[n]),
  }));
  return {
    instructions: sha(norm(text)),
    tools: sha(JSON.stringify(toolList)),
    toolNames: toolList.map((t) => t.name),
    _text: text, _tools: toolList,
  };
}

const exportsOf = (mod, names) => {
  const o = {};
  for (const k of (names || Object.keys(mod))) if (k in mod) o[k] = mod[k];
  return o;
};

const P = 'mastra/workflows/answer-business-question';
const PLAN_NAMES = ['PLAN_FIRST_LINE', 'PLAN_INSTRUCTIONS', 'planRequest', 'planMessages'];
const WRITE_NAMES = ['WRITE_ANSWER_FIRST_LINE', 'WRITE_ANSWER_INSTRUCTIONS', 'WRITE_ANSWER_VISUAL_LINE', 'visualCued', 'ANSWER_ROWS_CAP', 'ANSWER_REQUEST_CAP', 'findingStatus', 'writeAnswerRequest'];
const steps = {
  planner: () => ({
    'prompts.plan': exportsOf(m(P + '.prompts.js'), PLAN_NAMES),
    'schema.plan': exportsOf(m(P + '.schemas.js'), ['planSchema']),
    'agents.planWithModel': exportsOf(m(P + '.agents.js'), ['planWithModel']),
  }),
  writer: () => ({
    'prompts.write': exportsOf(m(P + '.prompts.js'), WRITE_NAMES),
    'schema.answer': exportsOf(m(P + '.schemas.js'), ['answerSchema']),
    'agents.writeAnswerWithModel': exportsOf(m(P + '.agents.js'), ['writeAnswerWithModel']),
  }),
  analysisPrompts: () => ({
    'prompts.analyse': exportsOf(m(P + '.prompts.js'), ['ANALYSE_VISUAL_LINE', 'analysePlanBlock', 'analyseSystemBlocks', 'visualCued']),
    'steps.catalogBlock': exportsOf(m(P + '.steps.js'), ['catalogBlock']),
  }),
  readiness: () => ({
    'readiness.steps': exportsOf(m('mastra/workflows/data-readiness-assessment.steps.js'), ['explainReportBlock', 'assessmentQuestion', 'READINESS_DEFAULT_QUESTION']),
  }),
  images: () => ({
    'prompts.images': exportsOf(m('mastra/workflows/read-images.prompts.js')),
    'agents.images': exportsOf(m('mastra/workflows/read-images.agents.js'), ['readImagesWithModel']),
  }),
  explainer: () => ({ 'prompts.explainer': exportsOf(m('mastra/agents/query-explainer.prompts.js')), 'agent.explainQuery': exportsOf(m('mastra/agents/query-explainer.agent.js'), ['explainQueryWithModel']) }),
  explorer: () => ({ 'prompts.explorer': exportsOf(m('mastra/agents/result-explorer.prompts.js')), 'agent.interpret': exportsOf(m('mastra/agents/result-explorer.agent.js'), ['interpretResultWithModel']) }),
  site: () => ({ 'prompts.site': exportsOf(m('mastra/workflows/review-website.prompts.js')), 'agents.site': exportsOf(m('mastra/workflows/review-website.agents.js')) }),
};

const AG = {
  planner: () => m('mastra/agents/analysis-planner.agent.js').analysisPlannerAgent,
  writer: () => m('mastra/agents/answer-writer.agent.js').answerWriterAgent,
};
// Extra agents/step groups beyond the target's own agent, per set.
const EXTRA = {
  'data-readiness': { agents: {}, steps: [] },
  'readiness-workflow': { agents: {}, steps: ['readiness'] },
  'analysis-planner': { agents: {}, steps: ['planner'] },
  'answer-writer': { agents: {}, steps: ['writer'] },
  'insights-analyst': { agents: { 'analysis-planner': 'planner', 'answer-writer': 'writer' }, steps: ['analysisPrompts', 'planner', 'writer'] },
  'insights-analyst-edge': { agents: { 'analysis-planner': 'planner', 'answer-writer': 'writer' }, steps: ['analysisPrompts', 'planner', 'writer'] },
  'image-reader': { agents: {}, steps: ['images'] },
  'query-explainer': { agents: {}, steps: ['explainer'] },
  'result-explorer': { agents: {}, steps: ['explorer'] },
  'result-explorer-edge': { agents: {}, steps: ['explorer'] },
  'site-reviewer': { agents: {}, steps: ['site'] },
};

(async () => {
  const reg = m('mastra/evals/eval-sets.js');
  const out = {};
  const full = process.argv.includes('--full');
  for (const set of reg.EVAL_SETS) {
    if (!(set.id in EXTRA) && !(set.name in EXTRA)) continue;
    const id = set.id in EXTRA ? set.id : set.name;
    const cfg = EXTRA[id];
    const target = reg.evalTargetOf(reg.evalSetTargetId(set), reg.evalSetAgentKey(set));
    const agents = { [target.agentKey]: await agentPart(target.agent) };
    for (const [k, g] of Object.entries(cfg.agents)) agents[k] = await agentPart(AG[g]());
    const stepGroups = {};
    for (const g of cfg.steps) Object.assign(stepGroups, steps[g]());
    const stepHashes = Object.fromEntries(Object.entries(stepGroups).map(([k, v]) => [k, sha(ser(v))]));
    const hooks = { orientation: target.orientation, configureContext: target.configureContext };
    const comp = {
      instructions: Object.fromEntries(Object.entries(agents).map(([k, a]) => [k, a.instructions])),
      tools: Object.fromEntries(Object.entries(agents).map(([k, a]) => [k, a.tools])),
      steps: stepHashes,
      hooks: sha(ser(hooks)),
    };
    out[id] = {
      target: reg.evalSetTargetId(set),
      agents: Object.keys(agents),
      toolNames: Object.fromEntries(Object.entries(agents).map(([k, a]) => [k, a.toolNames])),
      overall: sha(JSON.stringify(comp)),
      components: comp,
    };
    if (full) {
      out[id]._texts = Object.fromEntries(Object.entries(agents).map(([k, a]) => [k, { instructions: a._text, tools: a._tools }]));
      out[id]._steps = Object.fromEntries(Object.entries(stepGroups).map(([k, v]) => [k, canon(v)]));
    }
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
