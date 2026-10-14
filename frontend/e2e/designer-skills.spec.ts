import { test, expect } from './fixtures/app.fixture';
import { createWorldCupSession } from './helpers/app-actions';
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
 * specs/capabilities/visuals/spec.md. The model is the recording
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

/** Whether the model already received a tool result in this request. */
function hasToolResult(request: StubRequest): boolean {
  return request.messages.some((message) => message.role === 'tool');
}

function scriptedReply(request: StubRequest): StubReply {
  if (isDesignerCall(request)) return { text: JSON.stringify(SPEC_REPLY) };
  if (request.stream && !hasToolResult(request)) {
    return {
      toolCall: {
        name: 'run_readonly_sql',
        arguments: { sql: SQL, rationale: 'Count the matches per stage.' },
      },
    };
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
  await createWorldCupSession(page);
  await page.getByPlaceholder('Ask a follow-up question…').fill(QUESTION);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(page.getByText(/Data used \(1 query\)/)).toBeVisible();

  await page
    .getByRole('button', { name: 'Generate interactive visuals' })
    .click();
  await expect(page.getByText('Interactive visual generated')).toBeVisible();
  await expect(
    page.locator('iframe[title="Interactive visualization"]'),
  ).toBeVisible();
  await expect(page.getByText(VISUAL_TITLE).first()).toBeVisible();

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
