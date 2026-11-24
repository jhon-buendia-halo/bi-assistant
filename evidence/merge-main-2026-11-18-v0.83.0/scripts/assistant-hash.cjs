// Hash the assistant's (Emily's) instructions and tool list in one dist.
// Usage: node assistant-hash.cjs <dist>
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const dist = path.resolve(process.argv[2]);
process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ba9-hash-'));
const { assistantAgent } = require(path.join(dist, 'mastra/agents/assistant.agent.js'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function schemaOf(tool) {
  const s = tool.inputSchema;
  if (!s) return null;
  try {
    const { zodToJsonSchema } = require('zod-to-json-schema');
    return zodToJsonSchema(s);
  } catch {
    return typeof s.toJSONSchema === 'function' ? s.toJSONSchema() : String(s);
  }
}

(async () => {
  const ins = await assistantAgent.getInstructions();
  const text = typeof ins === 'string' ? ins : JSON.stringify(ins);
  const tools = (await (assistantAgent.listTools?.() ?? assistantAgent.getTools())) || {};
  const list = Object.keys(tools).sort().map((name) => ({
    name,
    description: tools[name].description,
    input: schemaOf(tools[name]),
  }));
  const out = {
    instructions: sha(text),
    instructionsChars: text.length,
    tools: sha(JSON.stringify(list)),
    perTool: Object.fromEntries(list.map((t) => [t.name, sha(JSON.stringify(t))])),
  };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ text, list }, null, 1));
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
