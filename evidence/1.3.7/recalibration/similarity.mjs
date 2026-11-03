// Cosine similarity between each memory case's probe question and each of its
// teach signals as the memory stores them (signalText), with OpenAI
// text-embedding-3-small, the memory's embedding model. Prints one row per
// signal. The key is read from the main checkout's .env and never printed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [setFile, signalTextJs, envFile, outFile] = process.argv.slice(2);
const { signalText } = require(signalTextJs);
const env = fs.readFileSync(envFile, 'utf8');
const line = env.split('\n').find((l) => /^\s*OPENAI_API_KEY\s*=/.test(l));
const key = line.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
if (!key) throw new Error('OPENAI_API_KEY not found');
const set = JSON.parse(fs.readFileSync(setFile, 'utf8'));
const items = [];
for (const c of set.cases) {
  items.push({ case: c, role: 'probe', text: c.probe.question });
  c.teach.forEach((t, i) =>
    items.push({
      case: c,
      role: `teach-${i + 1}`,
      kind: t.kind,
      text: signalText({ kind: t.kind, occurredAt: t.at, question: t.question, sql: t.sql, note: t.note }),
    }),
  );
}
const res = await fetch('https://api.openai.com/v1/embeddings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model: 'text-embedding-3-small', input: items.map((i) => i.text) }),
});
if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
const body = await res.json();
body.data.forEach((d, i) => (items[i].v = d.embedding));
const cos = (a, b) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return s / Math.sqrt(na * nb);
};
const rows = [];
for (const c of set.cases) {
  const probe = items.find((i) => i.case === c && i.role === 'probe');
  for (const t of items.filter((i) => i.case === c && i.role !== 'probe')) {
    rows.push({ id: c.id, category: c.category, split: c.split, signal: t.role, kind: t.kind, score: cos(probe.v, t.v) });
  }
}
fs.writeFileSync(outFile, JSON.stringify({ usage: body.usage, rows }, null, 2));
console.log(`embedded ${items.length} texts, ${body.usage.total_tokens} tokens`);
for (const r of rows) console.log(`${r.split.padEnd(8)} ${r.category.replace('memory-', '').padEnd(11)} ${r.score.toFixed(3)} ${r.signal} ${r.kind.padEnd(14)} ${r.id}`);
