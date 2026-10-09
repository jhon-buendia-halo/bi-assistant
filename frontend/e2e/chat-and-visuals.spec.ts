import { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_SESSION,
  WORLD_CUP_DATASET,
  createWorldCupWorkspace,
} from './helpers/app-actions';

const assistantMessageAt = '2026-09-15T12:00:01.000Z';

async function installDeterministicChatStream(
  page: Page,
  sessionId: string,
): Promise<void> {
  await page.evaluate(
    ({ id, sessionName, datasetName, answerAt }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.endsWith(`/sessions/${id}/messages/stream`)) {
          return originalFetch(input, init);
        }

        const request = JSON.parse(String(init?.body ?? '{}')) as {
          content?: string;
        };
        const question = request.content ?? '';
        const encoder = new TextEncoder();
        const timers: ReturnType<typeof setTimeout>[] = [];
        let closed = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (delay: number, event: unknown) => {
              timers.push(
                setTimeout(() => {
                  if (closed) return;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                  );
                }, delay),
              );
            };
            emit(20, {
              type: 'reasoning',
              content: 'Inspecting the tournament and match tables…',
            });
            emit(120, { type: 'tool', content: 'run_sql' });
            emit(220, {
              type: 'tool-result',
              content: JSON.stringify({
                tool: 'run_sql',
                input:
                  'SELECT tournament_year, champion FROM world_cup.tournaments',
                rowCount: 2,
              }),
            });
            emit(320, {
              type: 'text',
              content: 'Argentina won the 2022 World Cup',
            });

            if (question.includes('slow response')) return;

            timers.push(
              setTimeout(() => {
                if (closed) return;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'done',
                      session: {
                        id,
                        name: sessionName,
                        datasets: [datasetName],
                        messages: [
                          {
                            role: 'user',
                            content: question,
                            at: '2026-09-15T12:00:00.000Z',
                          },
                          {
                            role: 'assistant',
                            content:
                              '**Argentina** won the 2022 World Cup, while France won in 2018.',
                            at: answerAt,
                            data: [
                              {
                                tool: 'run_sql',
                                input:
                                  'SELECT tournament_year, champion FROM world_cup.tournaments',
                                rowCount: 2,
                              },
                            ],
                          },
                        ],
                        visualizations: [],
                      },
                    })}\n\n`,
                  ),
                );
                closed = true;
                controller.close();
              }, 1_200),
            );

            init?.signal?.addEventListener('abort', () => {
              closed = true;
              timers.forEach(clearTimeout);
              try {
                controller.error(new DOMException('Aborted', 'AbortError'));
              } catch {
                // The stream may already have completed.
              }
            });
          },
          cancel() {
            closed = true;
            timers.forEach(clearTimeout);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };
    },
    {
      id: sessionId,
      sessionName: WORLD_CUP_SESSION,
      datasetName: WORLD_CUP_DATASET,
      answerAt: assistantMessageAt,
    },
  );
}

test('renders streamed reasoning, tool activity, final Markdown, and supports stopping', async ({
  page,
}) => {
  const sessionId = await createWorldCupWorkspace(page);
  await installDeterministicChatStream(page, sessionId);

  const input = page.getByPlaceholder('Ask a follow-up question…');
  await input.fill('Who won the last two tournaments?');
  await page.getByLabel('Send message').click();

  await expect(page.getByText('Thinking')).toBeVisible();
  await expect(page.getByText('run_sql')).toBeVisible();
  await expect(page.getByText('2 rows')).toBeVisible();
  await expect(
    page.getByText('Argentina won the 2022 World Cup'),
  ).toBeVisible();
  await expect(page.getByText('France won in 2018.')).toBeVisible();

  await page.getByText(/Data used \(1 query\)/).click();
  await expect(page.getByText(/SELECT tournament_year/)).toBeVisible();

  await input.fill('Start a slow response');
  await page.getByLabel('Send message').click();
  await expect(page.getByLabel('Stop response')).toBeVisible();
  await page.getByLabel('Stop response').click();
  await expect(page.getByLabel('Send message')).toBeVisible();
  await expect(page.getByText('Thinking')).toBeHidden();
});

test('renders a deterministic interactive visualization and its version controls', async ({
  page,
}) => {
  const sessionId = await createWorldCupWorkspace(page);
  await installDeterministicChatStream(page, sessionId);

  await page
    .getByPlaceholder('Ask a follow-up question…')
    .fill('Compare champions');
  await page.getByLabel('Send message').click();
  await expect(page.getByText('France won in 2018.')).toBeVisible();

  const visualDocument = `<!doctype html><html><body style="background:#171717;color:white"><h1>World Cup champions</h1><div id="chart">2018 France · 2022 Argentina</div></body></html>`;
  await page.route(/\/sessions\/[^/]+\/visualizations$/, async (route) => {
    const createdAt = '2026-09-15T12:01:00.000Z';
    const metadata = {
      id: 'champions-visual',
      title: 'World Cup champions',
      description: 'Champions by tournament year',
      path: 'visualizations/champions-visual',
      sourceMessageAt: assistantMessageAt,
      createdAt,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          createdAt,
          sourceMessageAt: assistantMessageAt,
          instruction: 'Initial version',
        },
      ],
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        message: 'Interactive visual generated',
        session: {
          id: sessionId,
          name: WORLD_CUP_SESSION,
          datasets: [WORLD_CUP_DATASET],
          messages: [],
          visualizations: [metadata],
        },
        visualization: {
          ...metadata,
          document: visualDocument,
          version: 1,
        },
      }),
    });
  });

  await page
    .getByRole('button', { name: 'Generate interactive visuals' })
    .click();
  const visual = page.frameLocator('iframe[title="Interactive visualization"]');
  await expect(
    visual.getByRole('heading', { name: 'World Cup champions' }),
  ).toBeVisible();
  await expect(visual.getByText('2018 France · 2022 Argentina')).toBeVisible();
  await expect(page.getByTitle('Download bundle')).toBeVisible();

  await page.getByTitle('Version history').click();
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  await expect(page.getByText('current', { exact: true })).toBeVisible();
});
