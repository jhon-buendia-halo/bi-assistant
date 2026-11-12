import { test, expect } from './fixtures/app.fixture';
import { apiJson } from './helpers/api';
import { runQuestionOk } from './helpers/runs-api';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Skills the designer is given" in
 * specs/capabilities/visuals/spec.md, through "Generate interactive visuals"
 * on the answer of a Questions to Insights v2 run
 * (`POST /workflow-runs/:id/visualizations`, api.md 130). The model is the
 * recording OpenAI-compatible stub, so the scenario checks what the backend
 * sent to the visual designer (agents.md sections 6.4 and 7.2).
 */

const QUESTION = 'How many matches were played at each stage?';
const ANSWER = 'The group stage holds most of the matches.';
const SQL =
  'SELECT stage, COUNT(*) AS matches FROM world_cup.world_cup.matches GROUP BY stage';
const VISUAL_TITLE = 'Matches by stage';
const SKILL_TAG = '<interactive-visuals-skill>';

/** Lines only `reference/spec-mode.md` of the interactive-visuals skill has. */
const SPEC_MODE_TEXT = [
  '## The spec',
  '- **`select` picks the result set.** The `<data>` block is a list of separate',
  '- **Never invent a column.** Every `column`, `x`, `y`, `series` and table column',
];
/** Lines only `reference/freeform.md` of the interactive-visuals skill has. */
const FREEFORM_TEXT = [
  '## Fallback: freeform HTML/CSS/JavaScript',
  '### Data access',
  '### Composed answers',
  'window.qti.onRefresh(render)',
];

/** A spec naming only the columns the stub's query returns. */
const SPEC_REPLY = {
  title: VISUAL_TITLE,
  description:
    'The group stage is played far more often than any knockout round.',
  spec: {
    spec: 1,
    chart: {
      form: 'bar',
      select: ['stage', 'matches'],
      x: 'stage',
      y: 'matches',
      sort: { by: 'y', dir: 'desc' },
    },
  },
};

let stub: LlmStub;

function isDesignerCall(request: StubRequest): boolean {
  return systemTexts(request).some((text) => text.includes(SKILL_TAG));
}

/** Queries once, then answers; the designer gets the spec. */
function scriptedReply(request: StubRequest): StubReply {
  if (isDesignerCall(request)) return { text: JSON.stringify(SPEC_REPLY) };
  if (!request.stream) return { text: ANSWER };
  if (request.messages.at(-1)?.role === 'tool') return { text: ANSWER };
  return {
    toolCall: {
      name:
        request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ??
        'run_readonly_sql',
      arguments: { sql: SQL, rationale: 'Count the matches per stage.' },
    },
  };
}

test.beforeEach(async ({ page }) => {
  // Background
  stub = await startLlmStub();
  stub.reply = scriptedReply;
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

test('a spec-mode designer call carries only the spec-mode reference', async ({
  page,
}) => {
  // Given a Questions to Insights v2 run with an answer.
  const run = await runQuestionOk(page, QUESTION);
  expect(run.text).toContain(ANSWER);
  // When I generate an interactive visual from its answer.
  const generated = await apiJson<{
    visualization: { title?: string };
    run: { visualizations?: unknown[] };
  }>(page, 'POST', `/workflow-runs/${run.runId}/visualizations`, {});
  // Then the run holds the visual.
  expect(generated.run.visualizations ?? [], 'the run holds the visual').toHaveLength(1);
  expect(JSON.stringify(generated.visualization)).toContain(VISUAL_TITLE);

  // And the designer was called once, with only the spec-mode reference.
  const designerCalls = stub.requests.filter(isDesignerCall);
  expect(designerCalls, 'one designer call: the spec validated').toHaveLength(
    1,
  );
  const [designer] = designerCalls;
  expect(designer.stream).toBe(false);
  const skill = systemTexts(designer).find((text) => text.includes(SKILL_TAG))!;
  // Soft, so a failure lists every line that is wrong at once.
  expect
    .soft(skill.startsWith(`${SKILL_TAG}\n# Interactive Visuals\n`))
    .toBe(true);
  expect.soft(skill.endsWith('\n</interactive-visuals-skill>')).toBe(true);
  // The router body, never the front matter.
  expect.soft(skill).not.toContain('name: interactive-visuals');
  for (const line of SPEC_MODE_TEXT) expect.soft(skill).toContain(line);
  for (const line of FREEFORM_TEXT) expect.soft(skill).not.toContain(line);
});
