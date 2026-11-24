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
      path.join(os.tmpdir(), 'conversation-exports-api-'),
    ),
  };
});

import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Response } from 'express';
import { DATA_DIR } from '../../infrastructure/database/database.module';
import type { ArtifactsService } from '../artifacts/artifacts.service';
import type { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import { ConversationExportService } from './conversation-export.service';
import { ConversationExportsController } from './conversation-exports.controller';
import type {
  ConversationExportDoc,
  ConversationExportsRepository,
} from './conversation-exports.repository';

const DOC: ConversationExportDoc = {
  id: 'x-1',
  conversationId: 'c-1',
  runId: 'r-9',
  title: 'World Cup goals',
  createdAt: '2026-11-23T10:00:00.000Z',
  files: [
    {
      format: 'pptx',
      fileName: 'world-cup-goals.pptx',
      bytes: 6,
      slides: 7,
      path: join('exports', 'x-1', 'world-cup-goals.pptx'),
    },
  ],
};

function build() {
  const service = new ConversationExportService(
    {} as WorkflowRunsRepository,
    {} as ArtifactsService,
    {
      get: (id: string) => Promise.resolve(id === DOC.id ? DOC : null),
    } as unknown as ConversationExportsRepository,
    () => Promise.reject(new Error('no browser in this spec')),
  );
  return new ConversationExportsController(service);
}

function response() {
  const headers: Record<string, unknown> = {};
  let body: unknown;
  const res = {
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
    send: (value: unknown) => {
      body = value;
    },
  };
  return { res: res as unknown as Response, headers, body: () => body };
}

beforeAll(async () => {
  await mkdir(join(DATA_DIR, 'exports', 'x-1'), { recursive: true });
  await writeFile(join(DATA_DIR, DOC.files[0].path), Buffer.from('PK-ppt'));
});
afterAll(() => rm(DATA_DIR, { recursive: true, force: true }));

describe('GET /conversation-exports/:id/download (api.md 167)', () => {
  it('answers the file as an attachment named after it, with its content type', async () => {
    const { res, headers, body } = response();
    await build().download('x-1', res, 'pptx');
    expect(headers).toEqual({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="world-cup-goals.pptx"',
      'Content-Length': 6,
      'Cache-Control': 'no-store',
    });
    expect(body()).toEqual(Buffer.from('PK-ppt'));
  });

  it('answers 404 for an unknown export, or a format the export does not have', async () => {
    const { res } = response();
    await expect(build().download('nope', res, 'pdf')).rejects.toMatchObject({
      status: 404,
      message: 'Export not found',
    });
    await expect(build().download('x-1', res, 'pdf')).rejects.toMatchObject({
      status: 404,
      message: 'This export has no pdf file',
    });
  });

  it('answers 400 for a format that is neither pdf nor pptx', async () => {
    const { res } = response();
    for (const bad of ['docx', undefined, ['pdf']]) {
      await expect(build().download('x-1', res, bad)).rejects.toMatchObject({
        status: 400,
      });
    }
  });
});
