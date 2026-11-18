// Save gpt-5.6-luna (openai provider, effort low, as the loop's rounds) into a
// running instance, reading OPENAI_API_KEY from the main checkout's .env.
// Never prints the key.  Usage: node ba9-save-llm.mjs <baseUrl>
import { readFileSync } from 'node:fs';

const base = process.argv[2];
const env = readFileSync('/Users/selbver/Developer/question-to-insights/bi-assistant/.env', 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('OPENAI_API_KEY='));
const apiKey = (line ?? '').slice('OPENAI_API_KEY='.length).trim().replace(/^(['"])(.*)\1$/, '$2');
if (!apiKey) {
  console.error('no OPENAI_API_KEY');
  process.exit(2);
}
const res = await fetch(`${base}/llm/settings`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'low', apiKey }),
});
const body = await res.json();
console.log(res.status, body.ok, body.message, body.settings?.model, body.settings?.reasoningEffort);
process.exit(body.ok ? 0 : 1);
