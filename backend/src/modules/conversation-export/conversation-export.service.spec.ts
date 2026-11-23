// `marked` ships ESM only; Jest loads its UMD build instead. sanitize-html
// pulls in ESM-only dependencies the document builder's markdown needs.
jest.mock('marked', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
  require('../../../node_modules/marked/lib/marked.umd.js'),
);
jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: (html: string) => html,
}));
// The data directory: a fresh folder of this spec's own.
jest.mock('../../infrastructure/database/database.module', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const os = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    DATA_DIR: fs.mkdtempSync(
      path.join(os.tmpdir(), 'conversation-export-spec-'),
    ),
  };
});

import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR } from '../../infrastructure/database/database.module';
import {
  blueprintFromDraft,
  type DashboardDraft,
} from '../../mastra/workflows/bi-dashboard.schemas';
import type { ExportContent } from '../../mastra/workflows/export-request';
import type { ArtifactsService } from '../artifacts/artifacts.service';
import type { DashboardRef } from '../artifacts/entities/artifact.entity';
import type { WorkflowRunDoc } from '../workflows/workflow-run-steps';
import type { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import { NO_EXPORT_BROWSER_MESSAGE } from './conversation-export.contract';
import {
  ConversationExportService,
  NOTHING_TO_EXPORT_MESSAGE,
} from './conversation-export.service';
import type {
  ConversationExportDoc,
  ConversationExportsRepository,
} from './conversation-exports.repository';
import type { ExportBrowserSession } from './export-render';

const DRAFT: DashboardDraft = {
  title: 'Goals by team',
  summary: 'Goals per team.',
  theme: { mode: 'light', accent: '#2563eb', palette: ['#2563eb'] },
  layout: 'A KPI.',
  filters: [{ id: 'team', label: 'Team', kind: 'select', column: 'team' }],
  widgets: [
    {
      id: 'goals',
      title: 'Goals',
      kind: 'kpi',
      span: 4,
      measures: [
        {
          label: 'Goals',
          column: 'goals',
          aggregation: 'sum',
          format: 'number',
          unit: '',
        },
      ],
      dimension: '',
      description: 'All goals.',
      filteredBy: ['team'],
    },
  ],
  columns: [
    { name: 'team', type: 'string', description: 'The team.' },
    { name: 'goals', type: 'number', description: 'Goals.' },
  ],
};
const BLUEPRINT = blueprintFromDraft(DRAFT, [{ team: 'Brazil', goals: 3 }]);

const REF: DashboardRef = {
  artifactId: 'a-1',
  version: 1,
  title: 'World Cup Goals by Team and Tournament',
  action: 'created',
  widgetCount: 10,
  filterCount: 3,
  rowCount: 32,
  saved: true,
};

function run(
  id: string,
  startedAt: string,
  question: string,
  extra: Partial<WorkflowRunDoc> = {},
): WorkflowRunDoc {
  return {
    id,
    workflowId: 'orchestrated-answer',
    workflowName: 'Answer a Business Question (orchestrated)',
    input: {},
    conversationId: 'c-1',
    status: 'success',
    steps: [],
    datasets: ['World Cup'],
    startedAt,
    question,
    answer: {
      role: 'assistant',
      content: `Answer to ${question}`,
      at: startedAt,
    },
    ...extra,
  };
}

/** A conversation (World Cup, run 4b0cc1b7): two dashboard versions, then the export. */
const RUNS: WorkflowRunDoc[] = [
  run('r1', '2026-11-23T03:34:52.839Z', 'Create a dashboard of goals by team', {
    answer: {
      role: 'assistant',
      content: 'I have built version 1.',
      at: '2026-11-23T03:34:52.839Z',
      dashboard: REF,
    },
  }),
  run('r2', '2026-11-23T03:36:27.691Z', 'Replace the table with a bar chart', {
    answer: {
      role: 'assistant',
      content: 'Version 2 is ready.',
      at: '2026-11-23T03:36:27.691Z',
      dashboard: { ...REF, version: 2, action: 'updated', saved: false },
    },
  }),
  run('r-failed', '2026-11-23T03:40:00.000Z', 'A failed one', {
    status: 'failed',
    answer: undefined,
  }),
  run('r-now', '2026-11-23T05:12:18.566Z', 'Export the conversation to PDF', {
    status: 'running',
    answer: undefined,
  }),
  run('r-later', '2026-11-23T06:00:00.000Z', 'A later question'),
];

const CONTENT: ExportContent = {
  formats: ['pdf', 'pptx'],
  title: 'World Cup goals by team and tournament',
  summary: ['Version 1 was built.', 'Version 2 has a bar chart.'],
  turns: [
    { number: 1, headline: 'Built version 1', points: [] },
    { number: 2, headline: 'Version 2: a bar chart by stage', points: [] },
  ],
  includeSql: false,
};

/** A PDF of three pages, as far as the page count reads it. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Pages /Count 3 >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type /Page >>\n4 0 obj << /Type /Page >>\n',
  'latin1',
);
const PNG = Buffer.from('png');

function build(
  options: {
    runs?: WorkflowRunDoc[];
    session?: Partial<ExportBrowserSession>;
    noBrowser?: boolean;
  } = {},
) {
  const stored = new Map<string, ConversationExportDoc>();
  const session: jest.Mocked<ExportBrowserSession> = {
    captureDashboard: jest
      .fn()
      .mockResolvedValue([
        { image: { png: PNG, width: 1268, height: 160 }, tables: [] },
      ]),
    printPdf: jest.fn().mockResolvedValue(PDF),
    close: jest.fn().mockResolvedValue(undefined),
    ...options.session,
  } as jest.Mocked<ExportBrowserSession>;
  const launch = jest.fn(() =>
    options.noBrowser
      ? Promise.reject(new Error(NO_EXPORT_BROWSER_MESSAGE))
      : Promise.resolve(session),
  );
  const artifacts = {
    detail: jest.fn((artifactId: string, version: number) =>
      Promise.resolve({
        artifact: {
          id: artifactId,
          version,
          blueprint: BLUEPRINT,
          versions: [
            { version: 1, saved: true },
            { version: 2, saved: false },
          ],
        },
        rows: [{ team: 'Brazil', goals: 3 }],
      }),
    ),
  };
  const service = new ConversationExportService(
    {
      listConversation: jest.fn(() =>
        Promise.resolve([...(options.runs ?? RUNS)]),
      ),
    } as unknown as WorkflowRunsRepository,
    artifacts as unknown as ArtifactsService,
    {
      get: (id: string) => Promise.resolve(stored.get(id) ?? null),
      insert: (doc: ConversationExportDoc) => {
        stored.set(doc.id, doc);
        return Promise.resolve(doc);
      },
    } as unknown as ConversationExportsRepository,
    launch,
  );
  return { service, session, launch, artifacts, stored };
}

// pptxgenjs loads node:fs with a dynamic import when it sees Node, which
// Jest's CommonJS runtime cannot run; the slides' images are inline data,
// so the deck needs no file read and is written as in a browser.
const release = process.release;
beforeAll(() => {
  Object.defineProperty(process, 'release', {
    value: { ...release, name: 'jest' },
    configurable: true,
  });
});
afterAll(async () => {
  Object.defineProperty(process, 'release', {
    value: release,
    configurable: true,
  });
  await rm(DATA_DIR, { recursive: true, force: true });
});

describe('ConversationExportService (agents.md 3.18; api.md 167)', () => {
  it("reads the conversation's ended turns before the asking run, oldest first", async () => {
    const { service } = build();
    await expect(service.turns('c-1', 'r-now')).resolves.toEqual({
      questions: [
        'Create a dashboard of goals by team',
        'Replace the table with a bar chart',
      ],
      answers: ['I have built version 1.', 'Version 2 is ready.'],
    });
  });

  it('draws the dashboards, prints the PDF, writes the PowerPoint and stores the export', async () => {
    const { service, session, artifacts, stored } = build();
    const made = await service.export({
      conversationId: 'c-1',
      beforeRunId: 'r-now',
      content: CONTENT,
      brand: 'halo',
    });
    // Version 1 was replaced: only its first row; version 2 in full.
    expect(artifacts.detail.mock.calls).toEqual([
      ['a-1', 1],
      ['a-1', 2],
    ]);
    expect(
      session.captureDashboard.mock.calls.map(([, options]) => options),
    ).toEqual([{ firstRowOnly: true }, { firstRowOnly: false }]);
    expect(session.captureDashboard.mock.calls[0][0]).toContain('<html');
    const [html, footer] = session.printPdf.mock.calls[0];
    expect(html).toContain('Version 1, replaced by version 2');
    expect(html).toContain('Question 2');
    expect(html).not.toContain('A later question');
    expect(footer).toContain('class="pageNumber"');
    expect(session.close.mock.calls).toHaveLength(1);

    expect(made).toEqual({
      id: expect.any(String) as string,
      title: CONTENT.title,
      createdAt: expect.any(String) as string,
      files: [
        {
          format: 'pdf',
          fileName: 'world-cup-goals-by-team-and-tournament.pdf',
          bytes: PDF.length,
          pages: 3,
        },
        {
          format: 'pptx',
          fileName: 'world-cup-goals-by-team-and-tournament.pptx',
          bytes: expect.any(Number) as number,
          // Cover, summary, version 1's row, version 2's row, the queries.
          slides: 5,
        },
      ],
    });
    const doc = stored.get(made.id)!;
    expect(doc).toMatchObject({ conversationId: 'c-1', runId: 'r-now' });
    expect(doc.files[0].path).toBe(
      join('exports', made.id, 'world-cup-goals-by-team-and-tournament.pdf'),
    );
    const pptx = await readFile(join(DATA_DIR, doc.files[1].path));
    // A PowerPoint is a zip: it starts with PK.
    expect(pptx.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(pptx.length).toBe(made.files[1].bytes);
  });

  it('makes only the formats asked for', async () => {
    const { service, session } = build();
    const made = await service.export({
      conversationId: 'c-1',
      beforeRunId: 'r-now',
      content: { ...CONTENT, formats: ['pptx'] },
      brand: 'halo',
    });
    expect(session.printPdf.mock.calls).toHaveLength(0);
    expect(made.files.map((file) => file.format)).toEqual(['pptx']);
  });

  it('says so when the machine has no Edge or Chrome', async () => {
    const { service } = build({ noBrowser: true });
    await expect(
      service.export({
        conversationId: 'c-1',
        beforeRunId: 'r-now',
        content: CONTENT,
        brand: 'halo',
      }),
    ).rejects.toThrow(
      'Exporting needs Microsoft Edge or Google Chrome on this computer.',
    );
  });

  it('closes the browser when the print fails', async () => {
    const { service, session } = build({
      session: { printPdf: jest.fn().mockRejectedValue(new Error('crashed')) },
    });
    await expect(
      service.export({
        conversationId: 'c-1',
        beforeRunId: 'r-now',
        content: CONTENT,
        brand: 'halo',
      }),
    ).rejects.toThrow('crashed');
    expect(session.close.mock.calls).toHaveLength(1);
  });

  it('exports nothing from a conversation with no earlier answer', async () => {
    const { service, launch } = build({ runs: [RUNS[3]] });
    await expect(
      service.export({
        conversationId: 'c-1',
        beforeRunId: 'r-now',
        content: CONTENT,
        brand: 'halo',
      }),
    ).rejects.toThrow(NOTHING_TO_EXPORT_MESSAGE);
    expect(launch).not.toHaveBeenCalled();
  });

  it('runs one export at a time', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const order: string[] = [];
    const { service } = build({
      session: {
        printPdf: jest.fn(async () => {
          order.push('print');
          if (order.length === 1) await held;
          return PDF;
        }),
        close: jest.fn(() => {
          order.push('close');
          return Promise.resolve();
        }),
      },
    });
    const input = {
      conversationId: 'c-1',
      beforeRunId: 'r-now',
      content: { ...CONTENT, formats: ['pdf' as const] },
      brand: 'halo' as const,
    };
    const first = service.export(input);
    const second = service.export(input);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['print']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['print', 'close', 'print', 'close']);
  });

  it('serves a file: 400 for a bad format, 404 for an unknown export or a format it lacks', async () => {
    const { service } = build();
    const made = await service.export({
      conversationId: 'c-1',
      beforeRunId: 'r-now',
      content: { ...CONTENT, formats: ['pdf'] },
      brand: 'halo',
    });
    await expect(service.download(made.id, 'pdf')).resolves.toEqual({
      fileName: 'world-cup-goals-by-team-and-tournament.pdf',
      contentType: 'application/pdf',
      data: PDF,
    });
    await expect(service.download(made.id, 'docx')).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.download(made.id, undefined)).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.download('nope', 'pdf')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.download(made.id, 'pptx')).rejects.toMatchObject({
      status: 404,
    });
  });
});
