// Hashes each turn agent's compiled prompt (`getInstructions()`) and tool
// list (ids and descriptions), so base and branch can be compared without an
// eval run (lessons.md "Evals and agents").
// Usage: npx nest build in backend/, then
//   node evidence/1.23.4/measure-hashes.cjs backend/dist
const path = require('path');
const crypto = require('crypto');
const dist = path.resolve(process.argv[2]);
process.env.APP_DATA_DIR ||= require('fs').mkdtempSync(
  path.join(require('os').tmpdir(), 'measure-'),
);

const agents = {
  assistant: ['mastra/agents/assistant.agent.js', 'assistantAgent'],
  rfp: ['mastra/agents/rfp.agent.js', 'rfpAgent'],
  'data-readiness': ['mastra/agents/data-readiness.agent.js', 'dataReadinessAgent'],
  'assistant-v2': ['mastra/agents/assistant-v2.agent.js', 'assistantV2Agent'],
};

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

(async () => {
  const out = {};
  for (const [key, [file, name]] of Object.entries(agents)) {
    const agent = require(path.join(dist, file))[name];
    const instructions = await agent.getInstructions();
    const text = typeof instructions === 'string' ? instructions : JSON.stringify(instructions);
    const tools = (await agent.listTools?.()) ?? (await agent.getTools());
    const toolList = Object.keys(tools)
      .sort()
      .map((id) => `${id}\n${tools[id].description ?? ''}`)
      .join('\n---\n');
    out[key] = {
      instructionsChars: text.length,
      instructionsSha256: sha(text),
      tools: Object.keys(tools).length,
      toolListSha256: sha(toolList),
    };
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
