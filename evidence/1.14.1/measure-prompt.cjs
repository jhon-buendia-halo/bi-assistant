// Measures the assistant prompt sections for the BA-213 epic spec.
// Usage: npx nest build in backend/, then node measure-prompt.cjs backend/dist
const path = require('path');
const dist = path.resolve(process.argv[2]);
process.env.APP_DATA_DIR ||= require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'measure-'));

const prompt = require(path.join(dist, 'mastra/agents/assistant-prompt.js'));
const { assistantAgent } = require(path.join(dist, 'mastra/agents/assistant.agent.js'));

(async () => {
  const full = await assistantAgent.getInstructions();
  const text = typeof full === 'string' ? full : JSON.stringify(full);
  const tools = await assistantAgent.listTools?.() ?? await assistantAgent.getTools();
  const lines = prompt.toolLines(tools);
  const rules = prompt.ASSISTANT_WORKING_RULES.join('\n');
  const block = (start, end) => {
    const i = rules.indexOf(start);
    const j = end ? rules.indexOf(end, i) : rules.length;
    return rules.slice(i, j).length;
  };
  const out = {
    fullPrompt: text.length,
    identity: prompt.ASSISTANT_IDENTITY.join('\n').length,
    workingRules: rules.length,
    toolsSection: lines.join('\n').length,
    toolLines: Object.fromEntries(Object.keys(tools).map((k, n) => [k, lines[n].length])),
    clarificationParagraph: block('Call ask_clarification', 'For every question:'),
    visualsBlock: block('Interactive visuals:', 'Rules:'),
    skillsSectionOneSkill: prompt
      .skillsSection([{ name: 'sql-style', description: 'Use when writing or reviewing SQL.', dir: '/abs/path/to/skills/sql-style' }], false)
      .join('\n').length + 2,
    skillsSectionPerExtraSkill:
      prompt.skillsSection([1, 2].map((n) => ({ name: `s${n}`, description: 'Use when writing or reviewing SQL.', dir: `/abs/path/to/skills/s${n}` })), false).join('\n').length -
      prompt.skillsSection([{ name: 's1', description: 'Use when writing or reviewing SQL.', dir: '/abs/path/to/skills/s1' }], false).join('\n').length,
    sampleRowsMentions: (rules.match(/sample_rows/g) || []).length,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
