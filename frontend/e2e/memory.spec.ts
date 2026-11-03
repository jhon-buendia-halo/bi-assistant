import type { Locator, Page } from '@playwright/test';
import { test, expect, type Env } from './fixtures/app.fixture';
import {
  createKnowledgeSnippet,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  WORLD_CUP_DATASET,
  WORLD_CUP_DATASOURCE,
  openDatasourceSettings,
  openSessions,
} from './helpers/app-actions';
import { appSql } from './helpers/app-db';
import { apiJson } from './helpers/api';
import {
  EmbeddingsStub,
  bagOfWords,
  startEmbeddingsStub,
  topicVector,
} from './helpers/embeddings-stub';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';
import {
  OutboxRow,
  fileBytesHold,
  holdsResource,
  holdsThread,
  indexCopies,
  learnedMessages,
  outboxRows,
  storedSignal,
  summaryOf,
} from './helpers/memory-db';

/**
 * Mirrors the Feature "Memory from past sessions" in
 * specs/capabilities/knowledge/spec.md (R30 to R43, ADR-0031).
 *
 * The app runs its real "Mastra only" memory: the `memory_signals` outbox in
 * app.sqlite and the learning memories in mastra.sqlite. Two local stubs
 * stand in for the models: the recording LLM stub (saved as the LenAI
 * provider) answers every turn by running one SQL query on the World Cup
 * database, and writes the summary; the embeddings stub stands in for
 * OpenAI `text-embedding-3-small`, reached through `OPENAI_BASE_URL` with
 * the key from `OPENAI_API_KEY` (agents.md 2.1). What the memory holds is
 * read from both files.
 */

const HELP_TEXT =
  'When on, a thumbs-up or thumbs-down on an answer that ran SQL is remembered and offered to later sessions on the same datasource, after curated knowledge. Off by default.';
const LEARNED_HEADING =
  'Learned from past sessions (not curated; curated knowledge wins on conflict):';
/** Opening of the curated-knowledge block (agents.md 4.1, Block 3). */
const KNOWLEDGE_BLOCK_START = 'Curated dataset knowledge';
/** Opening of the summary step's instructions (agents.md 2.1). */
const SUMMARY_INSTRUCTIONS =
  'You keep the summary of what rated answers in past sessions taught';
/** What the stub writes as every learning memory's summary (R42). */
const SUMMARY =
  'Known pitfalls\n- Matches decided on penalties are not wins.\nTable guide\n- matches: one row per match.\nLearned glossary\n- stage: the round of the tournament.';
const MEMORY_FOOTNOTE =
  'Memory entries come from rated answers in past sessions; they are not curated.';
const FORGET_CONFIRM = 'Forget this memory? Later answers will not use it.';
/** A query that succeeds on the World Cup database and returns rows. */
const DEFAULT_SQL =
  'SELECT stage, COUNT(*) AS matches FROM world_cup.world_cup.matches GROUP BY stage';

/** The SQL the stub runs for a question; DEFAULT_SQL when not listed. */
const SQL_FOR: Record<string, string> = {};

let llm: LlmStub;
let embeddings: EmbeddingsStub;
let appDir: string;
/** The World Cup datasource: the scope of its learning memory (R35). */
let datasourceId: string;

/** The stub's answer to `question`, so a test can wait for it. */
function answerTo(question: string): string {
  return `The stub answered: ${question}`;
}

function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.length ? messageText(users.at(-1)!) : '';
}

function isSummaryCall(request: StubRequest): boolean {
  return systemTexts(request).some((text) =>
    text.includes(SUMMARY_INSTRUCTIONS),
  );
}

/**
 * Every chat turn runs one query and then answers; the turn is told from
 * the request's last user message (a session's history holds earlier ones).
 */
function scriptedReply(request: StubRequest): StubReply {
  if (isSummaryCall(request)) return { text: SUMMARY };
  const question = lastUserText(request);
  if (!request.stream || request.messages.at(-1)?.role === 'tool') {
    return { text: answerTo(question) };
  }
  return {
    toolCall: {
      name: 'run_readonly_sql',
      arguments: {
        sql: SQL_FOR[question] ?? DEFAULT_SQL,
        rationale: 'Count what the question asks for.',
      },
    },
  };
}

/** The first model call, from `from` on, of the turn that asked `question`. */
function turnRequest(question: string, from = 0): StubRequest {
  const request = llm.requests
    .slice(from)
    .find((r) => r.stream && !isSummaryCall(r) && lastUserText(r) === question);
  if (!request) throw new Error(`The model was never asked "${question}"`);
  return request;
}

test.beforeEach(async () => {
  llm = await startLlmStub();
  llm.reply = scriptedReply;
  embeddings = await startEmbeddingsStub();
});

test.afterEach(async () => {
  for (const key of Object.keys(SQL_FOR)) delete SQL_FOR[key];
  await llm.close();
  await embeddings.close();
});

/**
 * Starts the app on the embeddings stub, with the World Cup dataset and the
 * LLM stub saved. `env` overrides the environment (an `undefined` value
 * removes a variable), so no developer key ever reaches a real provider.
 */
async function openApp(
  launchApp: (dir: string, env?: Env) => Promise<{ page: Page }>,
  appDataDir: string,
  env: Env = {},
): Promise<Page> {
  appDir = appDataDir;
  const { page } = await launchApp(appDataDir, {
    OPENAI_API_KEY: 'sk-e2e-embeddings',
    OPENAI_BASE_URL: embeddings.baseUrl,
    ...env,
  });
  datasourceId = await seedWorldCupDataset(page);
  await saveLenaiSettings(page, llm.baseUrl);
  return page;
}

/** Given memory is on (`PUT /memory/settings`, api.md 109). */
async function memoryOn(page: Page): Promise<void> {
  const view = await apiJson<{ ok: boolean; enabled: boolean }>(
    page,
    'PUT',
    '/memory/settings',
    { enabled: true },
  );
  expect(view.enabled).toBe(true);
}

/** Makes the saved LLM settings name another provider, key unchanged. */
function useProvider(provider: 'openai' | 'anthropic'): void {
  appSql(
    appDir,
    `UPDATE "settings" SET doc = json_set(doc, '$.provider', ?) WHERE json_extract(doc, '$.key') = 'llm'`,
    provider,
  );
}

function toast(page: Page, message: string): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .getByText(message, { exact: true })
    .last();
}

async function openMemorySettings(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  const nav = page.getByRole('navigation', { name: 'Settings navigation' });
  await expect(nav).toBeVisible();
  const section = nav.getByRole('button', { name: 'Memory' });
  // Choosing the chosen section again deselects it (app-shell R5).
  if ((await section.getAttribute('aria-current')) !== 'page') {
    await section.click();
  }
  await expect(
    page.getByRole('heading', { name: 'Memory', exact: true }),
  ).toBeVisible();
}

function memorySwitch(page: Page): Locator {
  return page.getByRole('switch', { name: 'Memory of past sessions' });
}

/** Turns the lever in Settings → Memory and comes back to nothing open. */
async function turnMemory(page: Page, on: boolean): Promise<void> {
  await openMemorySettings(page);
  await expect(memorySwitch(page)).toHaveAttribute('aria-checked', String(!on));
  await memorySwitch(page).click();
  await expect(
    toast(page, on ? 'Memory turned on' : 'Memory turned off'),
  ).toBeVisible();
  await expect(memorySwitch(page)).toHaveAttribute('aria-checked', String(on));
}

/** Starts a session over "World Cup Core" and returns its id. */
async function newSession(page: Page, name: string): Promise<string> {
  await openSessions(page);
  await page
    .locator('header')
    .getByRole('button', { name: 'Start New Conversation' })
    .click();
  await page.getByPlaceholder('My new session').fill(name);
  await page
    .getByRole('button', { name: new RegExp(WORLD_CUP_DATASET) })
    .click();
  await page.getByRole('button', { name: /^Create$/ }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const label = await page
    .locator('header')
    .getByTestId('session-id')
    .getAttribute('aria-label');
  const id = /^Copy session ID (.+)$/.exec(label ?? '')?.[1];
  if (!id) throw new Error('The new session did not expose its id');
  return id;
}

async function openSession(page: Page, id: string): Promise<void> {
  await openSessions(page);
  await page.getByTestId(`session-${id}`).click();
  await expect(
    page.getByPlaceholder('Ask a follow-up question…'),
  ).toBeVisible();
}

/** Asks `question`, waits for the stub's answer and returns its turn. */
async function ask(page: Page, question: string): Promise<StubRequest> {
  const answers = page.getByText(answerTo(question), { exact: true });
  const before = await answers.count();
  const from = llm.requests.length;
  await page.getByPlaceholder('Ask a follow-up question…').fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(answers).toHaveCount(before + 1);
  return turnRequest(question, from);
}

/** The document id of the signal of a session's latest answer (api.md 7). */
async function latestAnswerSignal(page: Page, sessionId: string) {
  const session = await apiJson<{ messages: { role: string; at: string }[] }>(
    page,
    'GET',
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
  const answer = session.messages.filter((m) => m.role === 'assistant').at(-1);
  if (!answer) throw new Error('The session has no answer');
  return `rating:${sessionId}:${answer.at}`;
}

/** Waits until a signal is stored and its learning memory's summary written. */
async function learned(documentId: string): Promise<OutboxRow> {
  const row = await storedSignal(appDir, documentId);
  await expect
    .poll(() => summaryOf(appDir, datasourceId), {
      message: 'the summary is written',
      timeout: 30_000,
    })
    .toBe(SUMMARY);
  return row;
}

/** The learned message (one per signal) of a document id, as stored. */
function learnedTexts(documentId: string): string[] {
  return learnedMessages(appDir)
    .filter((message) => message.id === documentId)
    .map((message) => message.text);
}

/** The latest answer's "Knowledge in context" disclosure, opened. */
async function openKnowledge(page: Page): Promise<Locator> {
  const disclosure = page
    .locator('details', { hasText: /Knowledge in context \(\d+\)/ })
    .last();
  await disclosure.locator('summary').click();
  return disclosure;
}

/** The disclosure's entries from the memory (badged "Memory"). */
function memoryEntries(disclosure: Locator): Locator {
  return disclosure
    .locator('li')
    .filter({ has: disclosure.page().getByText('Memory', { exact: true }) });
}

/** An entry's text, one item per line of the signal as sent. */
async function entryLines(entry: Locator): Promise<string[]> {
  return (
    await entry.locator(':scope > span.flex-col > span').allTextContents()
  ).map((line) => line.trim());
}

function learnedBlockOf(request: StubRequest): string | undefined {
  return systemTexts(request).find((text) => text.startsWith(LEARNED_HEADING));
}

// ------------------------------------------------------------- the lever

test('memory is off by default', async ({ appDataDir, launchApp }) => {
  // Given the memory lever was never changed
  const page = await openApp(launchApp, appDataDir);
  await openMemorySettings(page);
  await expect(memorySwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(HELP_TEXT)).toBeVisible();
  const view = await apiJson<{ enabled: boolean }>(
    page,
    'GET',
    '/memory/settings',
  );
  expect(view.enabled).toBe(false);

  const question = 'Which stage had the most matches?';
  await newSession(page, 'Stages');
  await ask(page, question);
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();

  const similar = 'Which stage of the tournament had the most matches?';
  await newSession(page, 'Stages again');
  const request = await ask(page, similar);

  // Nothing was retained, and nothing was recalled.
  expect(outboxRows(appDataDir)).toEqual([]);
  expect(learnedMessages(appDataDir)).toEqual([]);
  expect(holdsThread(appDataDir, datasourceId)).toBe(false);
  expect(learnedBlockOf(request)).toBeUndefined();
  await expect(page.getByText(/Knowledge in context/)).toHaveCount(0);
  // No memory is called (knowledge Acceptance): no text was ever embedded.
  expect(embeddings.inputs).toEqual([]);
});

test('turning memory on in Settings', async ({ appDataDir, launchApp }) => {
  // Given the saved LLM configuration uses the provider OpenAI
  const page = await openApp(launchApp, appDataDir);
  useProvider('openai');
  await openMemorySettings(page);
  await expect(page.getByTestId('memory-embeddings')).toHaveText(
    'Embeddings: OpenAI text-embedding-3-small, with the key saved in LLM configuration.',
  );

  await memorySwitch(page).click();
  await expect(toast(page, 'Memory turned on')).toBeVisible();
  await expect(memorySwitch(page)).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await openMemorySettings(page);
  await expect(memorySwitch(page)).toHaveAttribute('aria-checked', 'true');

  await memorySwitch(page).click();
  await expect(toast(page, 'Memory turned off')).toBeVisible();
  await expect(memorySwitch(page)).toHaveAttribute('aria-checked', 'false');
});

test('the environment key embeds when the provider is not OpenAI', async ({
  appDataDir,
  launchApp,
}) => {
  // The suite's LLM is LenAI, and OPENAI_API_KEY is set.
  const page = await openApp(launchApp, appDataDir);
  await openMemorySettings(page);
  await expect(page.getByTestId('memory-embeddings')).toHaveText(
    'Embeddings: OpenAI text-embedding-3-small, with OPENAI_API_KEY from the environment.',
  );
});

test('no key for embeddings', async ({ appDataDir, launchApp }) => {
  // Given the saved LLM configuration uses the provider Anthropic and
  // OPENAI_API_KEY is not set
  const page = await openApp(launchApp, appDataDir, {
    OPENAI_API_KEY: undefined,
  });
  useProvider('anthropic');
  await openMemorySettings(page);
  await expect(page.getByTestId('memory-embeddings')).toHaveText(
    'No OpenAI key for embeddings: choose OpenAI in LLM configuration or set OPENAI_API_KEY. Until then nothing is remembered.',
  );
});

// ------------------------------------------------- what is retained

test('an approval in one session informs a question in another language', async ({
  appDataDir,
  launchApp,
}) => {
  const asked =
    'Who was the top scorer of the 2018 World Cup, excluding own goals?';
  const inSpanish = '¿Quién fue el máximo goleador del Mundial 2018?';
  // The stub reads both as one meaning, as a multilingual model would.
  embeddings.embed = (text) =>
    /top scorer|máximo goleador/.test(text) ? topicVector(1) : bagOfWords(text);
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);

  // Given in one session I gave a thumbs-up to the answer
  const first = await newSession(page, '2018 scorers');
  await ask(page, asked);
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  const signal = await learned(await latestAnswerSignal(page, first));
  expect(signal.kind).toBe('verified_query');
  expect(signal.datasourceId).toBe(datasourceId);
  // The summary was written from the stored signals (R42).
  const summaryCall = llm.requests.find(isSummaryCall)!;
  expect(summaryCall.messages.map(messageText).join('\n')).toContain(
    signal.content,
  );

  // When I start a new session on the same datasource and ask in Spanish
  await newSession(page, 'Goleadores');
  const request = await ask(page, inSpanish);

  const knowledge = await openKnowledge(page);
  const entries = memoryEntries(knowledge);
  const approval = entries.filter({ hasText: '[verified_query · ' });
  await expect(approval).toHaveCount(1);
  const lines = await entryLines(approval);
  expect(lines[0]).toMatch(/^\[verified_query · \d{4}-\d{2}-\d{2}\]$/);
  expect(lines[1]).toBe(`Question: ${asked}`);
  expect(lines[2]).toMatch(/^Approved SQL: /);
  const footnote = (await knowledge.locator('p').textContent()) ?? '';
  expect(footnote.replace(/\s+/g, ' ').trim().endsWith(MEMORY_FOOTNOTE)).toBe(
    true,
  );
  // What the model was sent: the learned block with the approval's text.
  expect(learnedBlockOf(request)).toContain(signal.content);

  // No Knowledge snippet, metric or verified query came from the memory:
  // the one verified query is the thumbs-up's own.
  expect(await apiJson<unknown[]>(page, 'GET', '/knowledge')).toEqual([]);
  expect(
    (await apiJson<{ metrics: unknown[] }>(page, 'GET', '/metrics')).metrics,
  ).toEqual([]);
  const verified = appSql<{ doc: string }>(
    appDataDir,
    'SELECT doc FROM "verified_queries"',
  ).map((row) => JSON.parse(row.doc) as { question: string });
  expect(verified.map((query) => query.question)).toEqual([asked]);
});

test('a thumbs-down is kept as a rejection, with its note when it has one', async ({
  appDataDir,
  launchApp,
}) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const sessionId = await newSession(page, 'Argentina');
  const noted = 'How many matches did Argentina win in 2022?';
  const note = 'It counted a match won on penalties as a win.';
  await ask(page, noted);

  await page.getByRole('button', { name: 'Mark answer as wrong' }).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('What was wrong?').fill(note);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note saved')).toBeVisible();

  const withNote = await storedSignal(
    appDataDir,
    await latestAnswerSignal(page, sessionId),
  );
  expect(withNote.kind).toBe('rejection');
  const lines = withNote.content.split('\n');
  expect(lines[0]).toMatch(/^\[rejection · \d{4}-\d{2}-\d{2}\]$/);
  expect(lines).toEqual([
    lines[0],
    `Question: ${noted}`,
    `Rejected SQL (do not reuse): ${DEFAULT_SQL}`,
    `Analyst note: ${note}`,
  ]);
  await expect
    .poll(() => learnedTexts(withNote.documentId))
    .toEqual([withNote.content]);

  // When I mark another answer as wrong without a note
  const plain = 'How many matches did Brazil win in 2022?';
  await ask(page, plain);
  await page
    .getByRole('button', { name: 'Mark answer as wrong' })
    .last()
    .click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  const withoutNote = await storedSignal(
    appDataDir,
    await latestAnswerSignal(page, sessionId),
  );
  expect(withoutNote.kind).toBe('rejection');
  expect(withoutNote.content.split('\n').slice(1)).toEqual([
    `Question: ${plain}`,
    `Rejected SQL (do not reuse): ${DEFAULT_SQL}`,
  ]);
  await expect
    .poll(() => learnedTexts(withoutNote.documentId))
    .toEqual([withoutNote.content]);

  // Neither is a correction, and nothing reads as approved or final.
  const rows = outboxRows(appDataDir);
  expect(rows.map((row) => row.kind)).toEqual(['rejection', 'rejection']);
  expect(rows.every((row) => row.documentId.startsWith('rating:'))).toBe(true);
  for (const text of learnedMessages(appDataDir).map((m) => m.text)) {
    expect(text).not.toMatch(/^(Approved|Final) SQL/m);
  }
});

test('row values never reach the memory', async ({ appDataDir, launchApp }) => {
  const question = 'How many goals did the top scorer of 2022 score?';
  SQL_FOR[question] =
    "SELECT stage, COUNT(*) AS goals FROM world_cup.world_cup.matches WHERE stage <> 'Lionel Messi' AND stage <> 'own_goal' GROUP BY stage";
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const sessionId = await newSession(page, 'Top scorer 2022');
  await ask(page, question);
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();

  const signal = await storedSignal(
    appDataDir,
    await latestAnswerSignal(page, sessionId),
  );
  const sqlLine =
    "Approved SQL: SELECT stage, COUNT(*) AS goals FROM world_cup.world_cup.matches WHERE stage <> '?' AND stage <> 'own_goal' GROUP BY stage";
  expect(signal.content.split('\n')[2]).toBe(sqlLine);
  await expect
    .poll(() => learnedTexts(signal.documentId))
    .toEqual([signal.content]);
  const copies = indexCopies(appDataDir, { documentId: signal.documentId });
  expect(copies).toEqual([signal.content]);
  for (const text of [signal.content, ...learnedTexts(signal.documentId)]) {
    expect(text).not.toContain('Lionel Messi');
  }
});

// ------------------------------------------------------------ recall

test('curated knowledge comes first and is said to win', async ({
  appDataDir,
  launchApp,
}) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const snippetBody = 'The fiscal year runs from July to June.';
  await createKnowledgeSnippet(page, {
    kind: 'instruction',
    title: 'Fiscal year',
    body: snippetBody,
    datasetId: WORLD_CUP_DATASET,
  });
  const [snippetBefore] = await apiJson<
    { id: string; body: string; enabled: boolean; updatedAt: string }[]
  >(page, 'GET', '/knowledge');

  // Given the memory holds a rejection whose note says the fiscal year is
  // the calendar year
  const first = await newSession(page, 'Revenue 2024');
  await ask(page, 'What was the revenue in fiscal year 2024?');
  await page.getByRole('button', { name: 'Mark answer as wrong' }).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page
    .getByLabel('What was wrong?')
    .fill('The fiscal year is the calendar year.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note saved')).toBeVisible();
  const rejection = await learned(await latestAnswerSignal(page, first));

  // When I ask a question about revenue in fiscal year 2025
  await newSession(page, 'Revenue 2025');
  const request = await ask(page, 'What was the revenue in fiscal year 2025?');

  const systems = systemTexts(request);
  const curated = systems.findIndex((text) =>
    text.startsWith(KNOWLEDGE_BLOCK_START),
  );
  const learnedAt = systems.findIndex((text) =>
    text.startsWith(LEARNED_HEADING),
  );
  expect(curated, 'the curated-knowledge block is sent').toBeGreaterThan(-1);
  expect(systems[curated]).toContain(
    `- [instruction] Fiscal year: ${snippetBody}`,
  );
  expect(learnedAt, 'the learned block comes after it').toBeGreaterThan(
    curated,
  );
  expect(systems[learnedAt]).toContain(rejection.content);

  // The disclosure lists the snippet, then the memory's entries.
  const knowledge = await openKnowledge(page);
  const items = knowledge.locator('li');
  await expect(items.first()).toContainText('Fiscal year');
  await expect(items.first()).toContainText(snippetBody);
  await expect(memoryEntries(knowledge).first()).not.toContainText(
    'Fiscal year',
  );
  await expect(
    memoryEntries(knowledge).filter({ hasText: '[rejection · ' }),
  ).toHaveCount(1);

  // And the snippet is unchanged.
  expect(await apiJson(page, 'GET', '/knowledge')).toEqual([snippetBefore]);
  expect(snippetBefore.body).toBe(snippetBody);
});

// ---------------------------------------------------- re-rating, forgetting

test('rating an answer again, or changing its note, replaces what it taught', async ({
  appDataDir,
  launchApp,
}) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const sessionId = await newSession(page, 'Goals 2014');
  await ask(page, 'Which team scored the most goals in 2014?');
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  const documentId = await latestAnswerSignal(page, sessionId);
  const approval = await storedSignal(appDataDir, documentId);
  expect(approval.kind).toBe('verified_query');
  await expect.poll(() => learnedTexts(documentId)).toEqual([approval.content]);

  // When I mark the same answer as wrong
  await page.getByRole('button', { name: 'Mark answer as wrong' }).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  const rejection = await storedSignal(appDataDir, documentId);
  expect(rejection.kind).toBe('rejection');
  // One rejection of that answer, and no approval any more.
  await expect
    .poll(() => learnedTexts(documentId))
    .toEqual([rejection.content]);
  expect(outboxRows(appDataDir)).toHaveLength(1);
  expect(indexCopies(appDataDir, { documentId })).toEqual([rejection.content]);
  expect(rejection.content).not.toContain('Approved SQL');

  // When I add the note "It joined goals to the wrong team."
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page
    .getByLabel('What was wrong?')
    .fill('It joined goals to the wrong team.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note saved')).toBeVisible();
  const noted = await storedSignal(appDataDir, documentId);
  expect(noted.content.split('\n').at(-1)).toBe(
    'Analyst note: It joined goals to the wrong team.',
  );
  await expect.poll(() => learnedTexts(documentId)).toEqual([noted.content]);
  // And no correction of that answer.
  const ids = [
    ...outboxRows(appDataDir).map((row) => row.documentId),
    ...learnedMessages(appDataDir).map((message) => message.id),
  ];
  expect(ids.filter((id) => id.startsWith('correction:'))).toEqual([]);

  // When I clear the note
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('What was wrong?').fill('');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note removed')).toBeVisible();
  const cleared = await storedSignal(appDataDir, documentId);
  expect(cleared.kind).toBe('rejection');
  expect(cleared.content).not.toContain('Analyst note');
  await expect.poll(() => learnedTexts(documentId)).toEqual([cleared.content]);
});

test('with memory off, re-rating an answer forgets what it taught', async ({
  appDataDir,
  launchApp,
}) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const sessionId = await newSession(page, 'Finals');
  await ask(page, 'How many finals went to extra time?');
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  const documentId = await latestAnswerSignal(page, sessionId);
  await storedSignal(appDataDir, documentId);
  await expect.poll(() => learnedTexts(documentId)).toHaveLength(1);

  // When I turn memory off and mark the same answer as wrong
  await turnMemory(page, false);
  await openSession(page, sessionId);
  await page.getByRole('button', { name: 'Mark answer as wrong' }).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();

  // Then the memory holds no signal of that answer
  await expect
    .poll(() => outboxRows(appDataDir).map((row) => row.documentId))
    .toEqual([]);
  await expect.poll(() => learnedTexts(documentId)).toEqual([]);
  expect(indexCopies(appDataDir, { documentId })).toEqual([]);
});

test('forget a memory', async ({ appDataDir, launchApp }) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const note = 'It counted a match won on penalties as a win.';
  const first = await newSession(page, 'Penalties 2022');
  await ask(page, 'How many matches were won on penalties in 2022?');
  await page.getByRole('button', { name: 'Mark answer as wrong' }).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('What was wrong?').fill(note);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note saved')).toBeVisible();
  const signal = await learned(await latestAnswerSignal(page, first));
  expect(fileBytesHold(appDataDir, 'mastra.sqlite', note)).toBe(true);

  // Given an answer's "Knowledge in context" lists an entry badged "Memory"
  // that holds a signal
  await newSession(page, 'Penalties 2018');
  await ask(page, 'How many matches were won on penalties in 2018?');
  const knowledge = await openKnowledge(page);
  const entry = memoryEntries(knowledge).filter({ hasText: '[rejection · ' });
  await expect(entry).toHaveCount(1);
  // A summary entry offers no Forget.
  await expect(
    memoryEntries(knowledge).filter({ hasText: 'summary' }),
  ).toHaveCount(1);
  await expect(
    knowledge.getByRole('button', { name: 'Forget memory summary' }),
  ).toHaveCount(0);

  // When I click "Forget" on it, and accept the confirmation
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await entry
    .getByRole('button', { name: /^Forget memory rejection · / })
    .click();
  await expect(toast(page, 'Memory forgotten')).toBeVisible();
  expect(asked).toBe(FORGET_CONFIRM);
  // The entry is still listed, and reads "Forgotten" where "Forget" was.
  await expect(entry).toHaveCount(1);
  await expect(entry.getByText('Forgotten', { exact: true })).toBeVisible();
  await expect(entry.getByRole('button', { name: /^Forget/ })).toHaveCount(0);

  // The memory no longer holds the signal, its embedding or the index's copy
  // of its text, nor any outbox row of it.
  expect(
    outboxRows(appDataDir).filter(
      (row) => row.documentId === signal.documentId,
    ),
  ).toEqual([]);
  expect(learnedTexts(signal.documentId)).toEqual([]);
  expect(indexCopies(appDataDir, { documentId: signal.documentId })).toEqual(
    [],
  );
  // Once the files are compacted, mastra.sqlite holds its note nowhere, and
  // app.sqlite keeps no trace of its outbox row (the answers keep their
  // own record of it, R38).
  expect(fileBytesHold(appDataDir, 'mastra.sqlite', note)).toBe(false);
  expect(fileBytesHold(appDataDir, 'app.sqlite', signal.id)).toBe(false);

  // No later answer lists it, in the summary or as an entry.
  await newSession(page, 'Penalties 2014');
  const later = await ask(
    page,
    'How many matches were won on penalties in 2014?',
  );
  expect(learnedBlockOf(later)).toBeUndefined();
  await expect(page.getByText(/Knowledge in context/)).toHaveCount(0);
});

test('deleting a datasource forgets what its sessions taught', async ({
  appDataDir,
  launchApp,
}) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const sessionId = await newSession(page, 'Hosts');
  await ask(page, 'Which country hosted the most matches?');
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  const signal = await learned(await latestAnswerSignal(page, sessionId));

  // When I delete the datasource and confirm
  await openDatasourceSettings(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page
    .locator('[data-testid^="datasource-"]')
    .filter({ hasText: WORLD_CUP_DATASOURCE })
    .getByTitle('Delete')
    .click();
  await expect(page.getByText('No datasources yet.')).toBeVisible();

  // Then the memory holds no signal and no summary of that datasource
  await expect
    .poll(() =>
      outboxRows(appDataDir).filter((row) => row.datasourceId === datasourceId),
    )
    .toEqual([]);
  expect(holdsThread(appDataDir, datasourceId)).toBe(false);
  expect(learnedMessages(appDataDir, datasourceId)).toEqual([]);
  expect(indexCopies(appDataDir, { datasourceId })).toEqual([]);
  expect(holdsResource(appDataDir, datasourceId)).toBe(false);
  expect(fileBytesHold(appDataDir, 'mastra.sqlite', SUMMARY)).toBe(false);
  expect(fileBytesHold(appDataDir, 'app.sqlite', signal.id)).toBe(false);
});

test('a memory that does not answer in time does not hold up a turn', async ({
  appDataDir,
  launchApp,
}) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const sessionId = await newSession(page, 'Attendance');
  await ask(page, 'Which match had the largest attendance?');
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  await learned(await latestAnswerSignal(page, sessionId));

  // Given recall takes longer than 2.5 seconds: the question's embedding is
  // held until the test ends.
  const slow = 'Which match had the largest attendance of all?';
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let heldAt = 0;
  embeddings.hold = (inputs) => {
    if (!inputs.some((text) => text.includes(slow))) return undefined;
    heldAt = Date.now();
    return held;
  };
  let askedAt = 0;
  llm.reply = (request) => {
    if (!askedAt && lastUserText(request) === slow) askedAt = Date.now();
    return scriptedReply(request);
  };
  try {
    await newSession(page, 'Attendance again');
    const request = await ask(page, slow);
    // The answer came while the recall was still unanswered, after at most
    // 2.5 seconds spent on recall (plus the time to send the turn).
    expect(heldAt, 'the question was sent for embedding').toBeGreaterThan(0);
    test.info().annotations.push({
      type: 'recall cut off after',
      description: `${askedAt - heldAt} ms`,
    });
    expect(askedAt - heldAt).toBeLessThan(2_500 + 2_000);
    expect(learnedBlockOf(request)).toBeUndefined();
    await expect(page.getByText(/Knowledge in context/)).toHaveCount(0);
  } finally {
    release();
  }
});

test('turning memory off keeps what it learned', async ({
  appDataDir,
  launchApp,
}) => {
  const page = await openApp(launchApp, appDataDir);
  await memoryOn(page);
  const taught = await newSession(page, 'Final goals');
  await ask(page, 'How many goals were scored in the 2014 final?');
  await page.getByRole('button', { name: 'Save as verified query' }).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  const signal = await learned(await latestAnswerSignal(page, taught));

  // When I turn memory off in Settings and ask the question
  await turnMemory(page, false);
  const question = 'How many goals were scored in the 2014 final match?';
  const sessionId = await newSession(page, 'Final goals again');
  const off = await ask(page, question);
  // Then nothing is recalled: the question is not even embedded.
  expect(learnedBlockOf(off)).toBeUndefined();
  expect(embeddings.inputs.some((text) => text.includes(question))).toBe(false);
  await expect(page.getByText(/Knowledge in context/)).toHaveCount(0);
  // What it learned is kept.
  expect(learnedTexts(signal.documentId)).toEqual([signal.content]);

  // When I turn memory on again and ask it again
  await turnMemory(page, true);
  await openSession(page, sessionId);
  const on = await ask(page, question);
  expect(learnedBlockOf(on)).toContain(signal.content);
  const knowledge = await openKnowledge(page);
  await expect(
    memoryEntries(knowledge).filter({ hasText: '[verified_query · ' }),
  ).toHaveCount(1);
});
