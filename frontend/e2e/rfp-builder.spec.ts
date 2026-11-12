import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { Download, Locator, Page } from '@playwright/test';
import { test, expect, type RunningApp } from './fixtures/app.fixture';
import { apiJson } from './helpers/api';
import { saveLenaiSettings } from './helpers/agents-api';
import { runWorkflow } from './helpers/runs-api';
import { scenarioStep } from './support/demo-captions';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "RFP builder" in specs/capabilities/rfp/spec.md. The
 * model is the recording OpenAI-compatible stub, scripted to call the RFP
 * Builder's tools; the tools run for real against the Intellify RFP API the
 * app embeds, which reads the shared `intellify_mercer_demo` database (see
 * .claude/skills/intellify-api). Every RFP record a test makes is deleted
 * after it, so the shared database is left as it was.
 */

const AGENT = 'RFP Builder';
const DATASET = 'Intellify RFP API';
const REQUIREMENT =
  'Load the "Intellify RFP API" sample in Settings → Testing Data first';
const DESCRIPTION =
  'Walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data, stage by stage, and assembles the RFP package.';
const STARTERS = [
  'Start an RFP for a client',
  'Which of my clients renew on 1 January 2027?',
  'Resume my draft RFPs',
];
const STAGE_SKILLS = [
  'rfp-carriers',
  'rfp-client-renewal',
  'rfp-current-program',
  'rfp-market-scope',
  'rfp-package',
  'rfp-requirements',
  'rfp-timeline',
];
const CLIENT = { oneCode: 'IC100100', name: 'Orchard Manufacturing' };
const TITLE = `${CLIENT.name} — 2027 benefits RFP`;
/** The slug of TITLE (api.md #105, as #14). */
const TITLE_SLUG = 'orchard-manufacturing-2027-benefits-rfp';
const PACKAGE_FILES = [
  'rfp.md',
  'rfp.pdf',
  'exhibits/exhibit-a-census.csv',
  'exhibits/exhibit-b-plan-designs.csv',
  'exhibits/exhibit-c-financials.csv',
  'exhibits/exhibit-d-carriers.csv',
  'manifest.json',
];
/** Who the records this spec makes directly are created by. */
const CREATED_BY = 'e2e:rfp-builder';

let stub: LlmStub;
/** RFP records to delete after the test. */
let rfpIds: string[] = [];

// ------------------------------------------------------------ helpers

/** Calls the embedded Intellify RFP API with this app's key. */
async function intellify<T = unknown>(
  app: RunningApp,
  appDataDir: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const base = app.intellifyApiUrl;
  expect(base, 'the CLI banner names the embedded Intellify API').toBeTruthy();
  const key = fs
    .readFileSync(path.join(appDataDir, '.intellify-api-key'), 'utf8')
    .trim();
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
}

interface RfpRecord {
  id: string;
  title: string;
  clientName: string;
  status: string;
  stage: number;
}

/** Creates an RFP for Orchard Manufacturing, 2027, with one line and one carrier. */
async function seedRfp(
  app: RunningApp,
  appDataDir: string,
  stage?: number,
): Promise<RfpRecord> {
  const created = await intellify<RfpRecord>(
    app,
    appDataDir,
    'POST',
    '/v1/rfps',
    {
      clientOneCode: CLIENT.oneCode,
      planYear: 2027,
      createdBy: CREATED_BY,
    },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  rfpIds.push(created.body.id);
  const id = created.body.id;
  const lines = await intellify(
    app,
    appDataDir,
    'PUT',
    `/v1/rfps/${id}/lines`,
    [{ line: 'Medical', marketBasis: 'as-is', planDesignIds: [] }],
  );
  expect(lines.status, JSON.stringify(lines.body)).toBe(200);
  const carriers = await intellify(
    app,
    appDataDir,
    'PUT',
    `/v1/rfps/${id}/carriers`,
    [{ insurer: 'Aetna', lines: ['Medical'], incumbent: true }],
  );
  expect(carriers.status, JSON.stringify(carriers.body)).toBe(200);
  if (stage !== undefined) {
    const patched = await intellify(
      app,
      appDataDir,
      'PATCH',
      `/v1/rfps/${id}`,
      {
        stage,
      },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  }
  return created.body;
}

/** The last user message of a request: which turn it belongs to. */
function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((m) => m.role === 'user');
  return users.length ? messageText(users[users.length - 1]) : '';
}

/** Tool results since the last user message: the step of the turn. */
function turnToolResults(request: StubRequest): string[] {
  let last = -1;
  request.messages.forEach((m, i) => {
    if (m.role === 'user') last = i;
  });
  return request.messages
    .slice(last + 1)
    .filter((m) => m.role === 'tool')
    .map(messageText);
}

/**
 * Scripts the stub per turn: the reply to a call is the script of the turn
 * (found by its last user message) at the index of the step (the tool results
 * since that message); past the end it answers the script's last entry.
 */
function script(
  turns: Record<string, StubReply[]>,
): (r: StubRequest) => StubReply {
  return (request) => {
    const steps = turns[lastUserText(request)];
    if (!steps) return { text: 'Noted.' };
    const step = turnToolResults(request).length;
    return steps[Math.min(step, steps.length - 1)];
  };
}

/** The streamed requests of the turn that asked `question`, oldest first. */
function requestsOf(question: string): StubRequest[] {
  return stub.requests.filter((r) => r.stream && lastUserText(r) === question);
}

/** Skill names in the `<available_skills>` catalog of a request. */
function catalogSkills(request: StubRequest): string[] {
  const catalog = systemTexts(request)
    .join('\n')
    .match(/<available_skills>[\s\S]*?<\/available_skills>/);
  if (!catalog) return [];
  return [...catalog[0].matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
}

async function openHub(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

async function openWorkflows(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Workflows', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Workflows', exact: true }),
  ).toBeVisible();
}

/** Entries of a zip (stored or deflated), read from its local headers. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let at = 0;
  while (at + 30 <= zip.length && zip.readUInt32LE(at) === 0x04034b50) {
    const method = zip.readUInt16LE(at + 8);
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extra = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString();
    const start = at + 30 + nameLength + extra;
    const data = zip.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at = start + size;
  }
  return entries;
}

async function downloaded(download: Download): Promise<Buffer> {
  const file = await download.path();
  return fs.readFileSync(file);
}

function packageCards(page: Page): Locator {
  return page.getByTestId('rfp-package-card');
}

/** Opens the RFP Builder's workflow page on its Run tab (plan 4.3). */
async function openRfpRunTab(page: Page): Promise<void> {
  await openWorkflows(page);
  await page.getByTestId('workflow-agent:rfp').click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(AGENT);
  await page.getByTestId('workflow-execute').click();
  await expect(page.getByTestId('workflow-panel-tab-run')).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

/** Types the message and runs one exchange; waits until the run is stored. */
async function runExchange(page: Page, message: string): Promise<void> {
  await page.getByTestId('workflow-input-message').fill(message);
  await page.getByTestId('workflow-run').click();
  await expect(page.getByTestId('workflow-run-status')).toHaveText(
    'Run succeeded',
    { timeout: 30_000 },
  );
}

// ------------------------------------------------------------ setup

test.beforeEach(async ({ page }) => {
  // Background: the LLM stub is the provider. The Intellify sample is
  // loaded in the shared database the embedded API reads.
  stub = await startLlmStub();
  rfpIds = [];
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async ({ app, appDataDir }) => {
  await stub.close();
  for (const id of rfpIds) {
    await intellify(app, appDataDir, 'DELETE', `/v1/rfps/${id}`).catch(
      () => undefined,
    );
  }
});

test.describe('without the API sample', () => {
  test('Run is disabled until the API sample is registered', async ({
    page,
  }) => {
    await openRfpRunTab(page);
    const run = page.getByTestId('workflow-run');
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute('title', REQUIREMENT);
    await expect(page.getByTestId('workflow-run-requirement')).toHaveText(
      REQUIREMENT,
    );
  });
});

test.describe('runs of the RFP Builder, one exchange each', () => {
  test.beforeEach(async ({ page }) => {
    // Background: the "Intellify RFP API" sample is registered.
    const result = await apiJson<{ ok: boolean; message: string }>(
      page,
      'POST',
      '/testing-data/intellify-api/load',
      {},
    );
    expect(result.message).toContain('loaded 10 entities');
  });

  test(
    'I build an RFP one exchange at a time',
    { tag: ['@demo', '@story-1.23.17'] },
    async ({ app, appDataDir, page }) => {
      const start = `Start an RFP for ${CLIENT.name}, plan year 2027`;
      const proposal = `Stage 1 — ${CLIENT.name} renews its Medical line on 1 January 2027. Shall I save the client and renewal as proposed?`;
      const confirm = 'yes';
      const saved = 'Stage 1 is saved. Next is stage 2, the current program.';
      const draft = 'Export a draft so I can share it';
      const drafted = 'Here is a draft of the RFP package, marked DRAFT.';
      // The first run reads the client and proposes; "yes" confirms it, so
      // the second run creates the RFP (stage 1 saved, rfp R4); the third
      // acts on it.
      let rfpId = '';
      stub.reply = (request) => {
        const results = turnToolResults(request);
        switch (lastUserText(request)) {
          case start:
            return results.length === 0
              ? { toolCall: { name: 'list_clients', arguments: { query: 'Orchard' } } }
              : { text: proposal };
          case confirm:
            if (results.length === 0) {
              return {
                toolCall: {
                  name: 'create_rfp',
                  arguments: { clientOneCode: CLIENT.oneCode, planYear: 2027 },
                },
              };
            }
            rfpId = (JSON.parse(results[0]) as { id: string }).id;
            return { text: saved };
          case draft:
            if (results.length === 0) {
              return {
                toolCall: { name: 'export_rfp_draft', arguments: { rfpId } },
              };
            }
            if (results.length === 1) {
              return {
                toolCall: {
                  name: 'show_in_panel',
                  arguments: {
                    kind: 'file',
                    path: `rfp/${rfpId}/draft/rfp.md`,
                    title: 'RFP document (draft)',
                  },
                },
              };
            }
            return { text: drafted };
          default:
            return { text: 'Noted.' };
        }
      };

      await scenarioStep(
        page,
        `When I run the RFP Builder on "${start}"`,
        async () => {
          await openRfpRunTab(page);
          await expect(page.getByTestId('workflow-input-message')).toHaveAttribute(
            'placeholder',
            'Name the client and plan year, or state your decision',
          );
          await runExchange(page, start);
        },
      );
      await scenarioStep(page, 'Then I see the stage-1 proposal', async () => {
        await expect(page.getByTestId('run-answer')).toContainText(proposal);
        // The agent's seven stages show inside its step; nothing is saved yet.
        await expect(page.getByTestId('workflow-run-phases').getByRole('listitem')).toHaveCount(7);
        await expect(page.getByTestId('workflow-run-phase-1')).toContainText(
          'Client and renewal',
        );
        await expect(page.getByTestId('workflow-run-phase-1')).not.toContainText('Done');
      });
      await scenarioStep(page, `When I click Continue and run "${confirm}"`, async () => {
        await page.getByTestId('workflow-run-continue').click();
        await expect(page.getByTestId('workflow-input-message')).toHaveValue('');
        await expect(page.getByTestId('workflow-run-continue-from')).toContainText(
          `Continues “${start}”`,
        );
        await runExchange(page, confirm);
        await expect(page.getByTestId('run-answer')).toContainText(saved);
        expect(rfpId, 'the confirmed proposal created the RFP').toMatch(/^[0-9a-f-]{36}$/);
        rfpIds.push(rfpId);
      });
      await scenarioStep(
        page,
        'Then the request the model received carries the earlier proposal',
        async () => {
          const first = requestsOf(confirm)[0];
          expect(first, `a streamed call for "${confirm}"`).toBeTruthy();
          const texts = first.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => `${m.role}:${messageText(m)}`);
          const asked = texts.findIndex((t) => t === `user:${start}`);
          const proposed = texts.findIndex((t) => t === `assistant:${proposal}`);
          const replied = texts.findIndex((t) => t === `user:${confirm}`);
          expect(asked, 'the earlier message').toBeGreaterThanOrEqual(0);
          expect(proposed, 'the earlier proposal').toBeGreaterThan(asked);
          expect(replied, 'the reply after both').toBeGreaterThan(proposed);
        },
      );
      await scenarioStep(page, "And the record's stage becomes 1", async () => {
        const record = await intellify<RfpRecord>(
          app,
          appDataDir,
          'GET',
          `/v1/rfps/${rfpId}`,
        );
        expect(record.status).toBe(200);
        expect(record.body.stage).toBe(1);
        await expect(page.getByTestId('workflow-run-phase-1')).toContainText('Done');
        await expect(page.getByTestId('workflow-run-phase-2')).toHaveAttribute(
          'aria-current',
          'step',
        );
      });
      await scenarioStep(
        page,
        `When I click Continue and run "${draft}"`,
        async () => {
          await page.getByTestId('workflow-run-continue').click();
          await runExchange(page, draft);
          await expect(page.getByTestId('run-answer')).toContainText(drafted);
          // Continue carried the RFP: the context block names it (rfp R7),
          // and the run starts from the stages the earlier run left.
          expect(systemTexts(requestsOf(draft)[0]).join('\n')).toContain(
            `Active RFP in this session: ${rfpId}`,
          );
          await expect(page.getByTestId('workflow-run-phase-1')).toContainText('Done');
        },
      );
      await scenarioStep(
        page,
        `Then I download "rfp-${TITLE_SLUG}-draft.zip" from the run's package card`,
        async () => {
          const card = packageCards(page);
          await expect(card.getByTestId('rfp-package-label')).toHaveText(
            'RFP package (draft) · 7 files',
          );
          await expect(page.getByTestId('run-rfp-document')).toContainText(
            `DRAFT — ${TITLE}`,
          );
          const [download] = await Promise.all([
            page.waitForEvent('download'),
            card.getByTestId('rfp-package-download').click(),
          ]);
          await expect(page.getByText('RFP package downloaded')).toBeVisible();
          expect(download.suggestedFilename()).toBe(`rfp-${TITLE_SLUG}-draft.zip`);
          const zip = unzip(await downloaded(download));
          expect([...zip.keys()].sort()).toEqual([...PACKAGE_FILES].sort());
          expect(zip.get('rfp.md')!.toString().split('\n')[0]).toBe(
            `# DRAFT — ${TITLE}`,
          );
          const manifest = JSON.parse(
            zip.get('manifest.json')!.toString(),
          ) as Record<string, unknown>;
          expect(manifest).toMatchObject({ rfpId, draft: true, stage: 1 });
        },
      );
    },
  );
});

test.describe('with the API sample registered', () => {
  test.beforeEach(async ({ page }) => {
    // Background: the "Intellify RFP API" sample is registered.
    const result = await apiJson<{ ok: boolean; message: string }>(
      page,
      'POST',
      '/testing-data/intellify-api/load',
      {},
    );
    expect(result.message).toContain('loaded 10 entities');
  });

  test('the hub offers the RFP Builder as an Official agent', async ({
    page,
  }) => {
    await openHub(page);
    const official = page.getByTestId('agent-section-official');
    const card = official.getByTestId('agent-rfp');
    await expect(card).toContainText(AGENT);
    await expect(card).toContainText('Owner: Official');
    // A chat starts from the RFP Builder's workflow, never its agent card.
    await expect(
      page.getByTestId('agent-card-rfp').getByRole('button', {
        name: /Start chat/,
      }),
    ).toHaveCount(0);
  });

  test('the first run loads the stage-1 skill and reads the client', async ({
    page,
  }) => {
    const question = 'Start an RFP for Orchard Manufacturing';
    const answer = 'I found Orchard Manufacturing (IC100100).';
    stub.reply = script({
      [question]: [
        {
          toolCall: {
            name: 'skill',
            arguments: { name: 'rfp-client-renewal' },
          },
        },
        { toolCall: { name: 'list_clients', arguments: { query: 'Orchard' } } },
        { text: answer },
      ],
    });

    const result = await runWorkflow(page, 'agent:rfp', { message: question });
    expect(result.status, result.body).toBe(200);
    expect(result.error, result.body).toBeUndefined();
    expect(result.text).toContain(answer);
    expect(
      result.events.some(
        (e) =>
          e.type === 'tool' &&
          (JSON.parse(String(e.content)) as { name?: string }).name ===
            'list_clients',
      ),
      'the list_clients step is reported',
    ).toBe(true);

    const requests = requestsOf(question);
    expect(requests.length).toBeGreaterThanOrEqual(3);
    const first = requests[0];
    // The RFP Builder runs, with its tools and no SQL tool (R3).
    expect(first.tools).toEqual(
      expect.arrayContaining([
        'list_clients',
        'create_rfp',
        'export_rfp_package',
      ]),
    );
    expect(first.tools).not.toContain('run_readonly_sql');
    expect(systemTexts(first)[0].startsWith('You are the RFP Builder')).toBe(
      true,
    );
    // The skill catalog carries the seven stage skills (R4).
    expect([...catalogSkills(first)].sort()).toEqual(STAGE_SKILLS);
    // Block R1 orients it: the API datasource, no active RFP, today (R7).
    const system = systemTexts(first).join('\n');
    expect(system).toContain('Intellify RFP API for this session: datasource');
    expect(system).toContain(
      'No RFP is active in this session yet: start at stage 1.',
    );
    expect(system).toContain(
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
    );
    // The second call carried the stage-1 skill; the third the clients read.
    expect(turnToolResults(requests[1])[0]).toContain(
      '# Stage 1 — Client and renewal',
    );
    expect(turnToolResults(requests[2])[1]).toContain(CLIENT.name);
    expect(turnToolResults(requests[2])[1]).toContain(CLIENT.oneCode);
  });

  test('a created RFP becomes the active RFP of the run that continues it', async ({
    app,
    appDataDir,
    page,
  }) => {
    const create = 'Create the RFP for the 2027 plan year';
    const next = 'What is the next stage?';
    stub.reply = script({
      [create]: [
        {
          toolCall: {
            name: 'create_rfp',
            arguments: { clientOneCode: CLIENT.oneCode, planYear: 2027 },
          },
        },
        { text: 'The draft RFP is created.' },
      ],
      [next]: [{ text: 'Stage 2 is the current program.' }],
    });

    const first = await runWorkflow(page, 'agent:rfp', { message: create });
    expect(first.status, first.body).toBe(200);
    expect(first.text).toContain('The draft RFP is created.');
    const result = JSON.parse(turnToolResults(requestsOf(create)[1])[0]) as {
      id: string;
      status: string;
    };
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    rfpIds.push(result.id);

    const second = await runWorkflow(
      page,
      'agent:rfp',
      { message: next, rfpId: result.id },
      { fromRunId: first.runId! },
    );
    expect(second.status, second.body).toBe(200);
    expect(second.text).toContain('Stage 2 is the current program.');
    const system = systemTexts(requestsOf(next)[0]).join('\n');
    expect(system).toContain(
      `Active RFP in this session: ${result.id} — "${TITLE}" for ${CLIENT.name} (${CLIENT.oneCode}), plan year 2027, status draft`,
    );

    const list = await intellify<{ data: RfpRecord[] }>(
      app,
      appDataDir,
      'GET',
      `/v1/rfps?clientOneCode=${CLIENT.oneCode}&status=draft&per_page=500`,
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toContainEqual(
      expect.objectContaining({
        id: result.id,
        clientName: CLIENT.name,
        status: 'draft',
      }),
    );
  });

  test('the package is downloadable from a run', async ({
    app,
    appDataDir,
    page,
  }, testInfo) => {
    const rfp = await seedRfp(app, appDataDir, 6);
    const question = 'Build the package';
    const answer = 'The RFP package is ready to download.';
    stub.reply = script({
      [question]: [
        {
          toolCall: {
            name: 'export_rfp_package',
            arguments: { rfpId: rfp.id },
          },
        },
        { text: answer },
      ],
    });

    await openRfpRunTab(page);
    await runExchange(page, question);
    await expect(page.getByTestId('run-answer')).toContainText(answer);

    const card = packageCards(page);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(rfp.title);
    await expect(card.getByTestId('rfp-package-label')).toHaveText(
      'RFP package · 7 files',
    );
    await expect(card.getByTestId('rfp-package-draft-chip')).toHaveCount(0);
    await expect(card.getByTestId('rfp-package-download-pdf')).toHaveText(
      'Download RFP (PDF)',
    );
    await expect(card.getByTestId('rfp-package-download')).toHaveText(
      'Download package (.zip)',
    );
    // A link per file: the document in Markdown and PDF, each exhibit (R9);
    // manifest.json is only in the zip (ui.md 4.12).
    await expect
      .soft(card.getByTestId('rfp-package-file'))
      .toHaveText(PACKAGE_FILES.filter((name) => name !== 'manifest.json'));
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('rfp-package-card.png'),
    });

    const [zipDownload] = await Promise.all([
      page.waitForEvent('download'),
      card.getByTestId('rfp-package-download').click(),
    ]);
    await expect(page.getByText('RFP package downloaded')).toBeVisible();
    const zip = unzip(await downloaded(zipDownload));
    expect([...zip.keys()].sort()).toEqual([...PACKAGE_FILES].sort());
    expect(zip.get('rfp.md')!.toString().split('\n')[0]).toBe(`# ${TITLE}`);
    expect(zip.get('rfp.pdf')!.subarray(0, 5).toString()).toBe('%PDF-');
    const manifest = JSON.parse(zip.get('manifest.json')!.toString()) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({ rfpId: rfp.id, title: TITLE });
    expect(manifest).not.toHaveProperty('draft');
    fs.writeFileSync(
      testInfo.outputPath('manifest.json'),
      zip.get('manifest.json')!,
    );
    // The file is named after the RFP (R9, api.md #105).
    expect.soft(zipDownload.suggestedFilename()).toBe(`rfp-${TITLE_SLUG}.zip`);

    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      card.getByTestId('rfp-package-download-pdf').click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toBe('rfp.pdf');
    expect((await downloaded(pdfDownload)).subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
  });

  test('I export a draft before the review', async ({
    app,
    appDataDir,
    page,
  }, testInfo) => {
    // Given an RFP at stage 3.
    const rfp = await seedRfp(app, appDataDir, 3);
    const question = 'Export a draft so I can share it with my manager';
    const answer = 'Here is a draft of the RFP package, marked DRAFT.';
    stub.reply = script({
      [question]: [
        {
          toolCall: { name: 'export_rfp_draft', arguments: { rfpId: rfp.id } },
        },
        { text: answer },
      ],
    });

    await openRfpRunTab(page);
    await runExchange(page, question);
    await expect(page.getByTestId('run-answer')).toContainText(answer);

    const card = packageCards(page);
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('rfp-package-label')).toHaveText(
      'RFP package (draft) · 7 files',
    );
    await expect(card.getByTestId('rfp-package-draft-chip')).toHaveText(
      'Draft',
    );
    await expect(card.getByTestId('rfp-package-download')).toHaveText(
      'Download draft (.zip)',
    );
    await expect(card.getByTestId('rfp-package-download-pdf')).toHaveText(
      'Download draft (PDF)',
    );
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('rfp-package-draft-card.png'),
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      card.getByTestId('rfp-package-download').click(),
    ]);
    const zip = unzip(await downloaded(download));
    expect([...zip.keys()].sort()).toEqual([...PACKAGE_FILES].sort());
    const markdown = zip.get('rfp.md')!.toString();
    const today = new Date().toISOString().slice(0, 10);
    expect(markdown.split('\n')[0]).toBe(`# DRAFT — ${TITLE}`);
    expect(markdown).toContain(
      `Draft exported ${today} at stage 3 of 7 — not for release to carriers.`,
    );
    const manifest = JSON.parse(zip.get('manifest.json')!.toString()) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({ rfpId: rfp.id, draft: true, stage: 3 });
    fs.writeFileSync(
      testInfo.outputPath('manifest-draft.json'),
      zip.get('manifest.json')!,
    );
    // R16: downloading a draft shows the same toast as the final package,
    // and the zip is named after the RFP with "-draft" (api.md #105).
    await expect.soft(page.getByText('RFP package downloaded')).toBeVisible();
    expect
      .soft(download.suggestedFilename())
      .toMatch(new RegExp(`^rfp-(draft-)?${TITLE_SLUG}-draft\\.zip$`));
  });

  test('an RFP Builder run has no assistant controls', async ({ page }) => {
    const question = 'Which of my clients renew on 1 January 2027?';
    const answer = 'Here are the clients renewing on 1 January 2027.';
    stub.reply = script({ [question]: [{ text: answer }] });

    await openRfpRunTab(page);
    // R15: no Careful or Deep analysis toggle on the form.
    await expect(page.getByRole('button', { name: 'Careful mode' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Deep analysis' })).toHaveCount(0);
    await runExchange(page, question);
    await expect(page.getByTestId('run-answer')).toContainText(answer);
  });

  test('the System Prompt tab shows the RFP Builder’s prompt', async ({
    page,
  }) => {
    await openHub(page);
    await page.getByTestId('agent-rfp').click();
    await expect(
      page.getByRole('heading', { name: AGENT, exact: true }),
    ).toBeVisible();

    await page.getByTestId('agent-tab-prompt').click();
    const prompt = page.getByTestId('agent-prompt-view');
    await expect(prompt).toContainText('You are the RFP Builder');
    expect(
      (await prompt.innerText()).trim().startsWith('You are the RFP Builder'),
    ).toBe(true);

    const tab = page.getByTestId('agent-tab-skills');
    await tab.click();
    await expect(tab).toHaveText('Skills (7)');
    for (const name of STAGE_SKILLS) {
      const row = page.getByTestId(`agent-skill-${name}`);
      await expect(row).toContainText('Built-in');
      await expect(row).toContainText('On demand');
    }
  });
});
