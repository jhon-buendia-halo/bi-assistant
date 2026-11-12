import { test, expect } from './fixtures/app.fixture';
import { runAssistantOk } from './helpers/runs-api';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Skills the designer is given" in
 * specs/capabilities/visuals/spec.md, through a run of the Assistant (the
 * model asks for the visual with `create_visual`). The model is the recording
 * OpenAI-compatible stub, so the scenario checks what the backend sent to
 * the visual designer (agents.md sections 6.4 and 7.2).
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

/** How many tool results the model already received in this request. */
function toolResults(request: StubRequest): number {
  return request.messages.filter((message) => message.role === 'tool').length;
}

const CHART_REQUEST = 'Chart the matches per stage as bars.';

function isChartTurn(request: StubRequest): boolean {
  return request.messages.some(
    (message) =>
      message.role === 'user' && messageText(message).includes(CHART_REQUEST),
  );
}

/**
 * Queries once; on the chart request it then asks for a visual without
 * saying what to chart (the visual is made from an earlier answer, so it is
 * a follow-up run); then answers.
 */
function scriptedReply(request: StubRequest): StubReply {
  if (isDesignerCall(request)) return { text: JSON.stringify(SPEC_REPLY) };
  if (!request.stream) return { text: ANSWER };
  const results = toolResults(request);
  if (results === 0) {
    return {
      toolCall: {
        name: 'run_readonly_sql',
        arguments: { sql: SQL, rationale: 'Count the matches per stage.' },
      },
    };
  }
  if (results === 1 && isChartTurn(request)) {
    return { toolCall: { name: 'create_visual', arguments: {} } };
  }
  return { text: ANSWER };
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
  const first = await runAssistantOk(page, QUESTION);
  expect(first.text).toContain(ANSWER);
  // The visual is made from the earlier answer: a follow-up run.
  const chart = await runAssistantOk(page, CHART_REQUEST, {
    fromRunId: first.runId,
  });
  expect(chart.run?.visualizations ?? [], 'the run holds the visual').toHaveLength(1);
  expect(JSON.stringify(chart.run)).toContain(VISUAL_TITLE);

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

test('a chart asked for in a run is designed from my request when the model gives no instruction', async ({
  page,
}) => {
  const first = await runAssistantOk(page, QUESTION);
  await runAssistantOk(page, CHART_REQUEST, { fromRunId: first.runId });

  const designer = stub.requests.filter(isDesignerCall).at(-1)!;
  const prompt = designer.messages
    .filter((message) => message.role === 'user')
    .map(messageText)
    .join('\n');
  expect(prompt).toContain(`<instruction>\n${CHART_REQUEST}\n</instruction>`);
});
