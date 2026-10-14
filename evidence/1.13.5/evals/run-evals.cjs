// Scratch eval driver (not committed): same wiring as backend/src/mastra/evals/run-assistant-evals.ts,
// but passes the world-cup case ids (the shipped CLI passes none and trips the one-fixture preflight)
// and writes every case result as JSON for a before/after diff.
// Usage: BACKEND=<backend dir> APP_DATA_DIR=<dir> OUT=<file.json> EVAL_DATASETS="World Cup Core" node run-evals.cjs
const path = require('path');
const fs = require('fs');
const backend = process.env.BACKEND;
const dist = (p) => path.join(backend, 'dist', p);
const req = require('module').createRequire(path.join(backend, 'package.json'));
const CASES = process.env.CASES ? process.env.CASES.split(',') : ['champion-2022', 'final-score-2018', 'top-scorer-2022', 'shootouts', 'biggest-venue', 'schema-discovery', 'ambiguous-best-team', 'possession-vs-result', 'out-of-scope', 'visual-request'];

async function main() {
  const { NestFactory } = req('@nestjs/core');
  const { AppModule } = require(dist('app.module'));
  const { CurrentUserService, LOCAL_USER } = require(dist('modules/auth/current-user.service'));
  const { SessionsService } = require(dist('modules/sessions/sessions.service'));
  const { KnowledgeService } = require(dist('modules/knowledge/knowledge.service'));
  const { runAssistantEvals } = require(dist('mastra/evals/assistant.evals'));
  const datasets = process.env.EVAL_DATASETS.split(',').map((s) => s.trim());
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await app.get(CurrentUserService).runAs(LOCAL_USER, async () => {
      const sessions = app.get(SessionsService);
      const knowledge = await app.get(KnowledgeService).definitionBlock(datasets);
      const results = await runAssistantEvals(datasets, (r) => {
        console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.id}  (${r.durationMs}ms)`);
        if (r.error) console.log(`      error: ${r.error}`);
        for (const c of r.checks ?? []) if (!c.passed) console.log(`      ${c.id}: ${c.reason ?? c.score}`);
      }, CASES, sessions, knowledge);
      fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
      console.log(`\n${results.filter((r) => r.passed).length}/${results.length} questions passed`);
    });
  } finally {
    await app.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
