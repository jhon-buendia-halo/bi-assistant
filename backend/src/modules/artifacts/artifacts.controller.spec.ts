// `marked` and `sanitize-html` pull in ESM-only dependencies; the document
// builder's markdown pipeline is not what these specs are about.
jest.mock('marked', () => ({
  marked: { parse: (markdown: string) => `<p>${markdown}</p>` },
}));
jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: (html: string) => html,
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { SAMPLE_BLUEPRINT } from '../../mastra/workflows/dashboard-blueprint.sample';
import { ArtifactsController } from './artifacts.controller';
import type { ArtifactsService } from './artifacts.service';

const BLUEPRINT = SAMPLE_BLUEPRINT;

function build(rows: Record<string, unknown>[] | null) {
  const calls: {
    method: string;
    id: string;
    version?: number;
    body?: unknown;
  }[] = [];
  const service = {
    detail: (id: string, version?: number) => {
      calls.push({ method: 'detail', id, version });
      if (version === 9) {
        return Promise.reject(
          new NotFoundException(`Artifact "${id}" has no version 9`),
        );
      }
      return Promise.resolve({
        artifact: { id, version: version ?? 2, blueprint: BLUEPRINT },
        rows,
      });
    },
    save: (id: string, body: unknown) => {
      calls.push({ method: 'save', id, body });
      const version = (body as { version?: number } | undefined)?.version;
      return Promise.resolve({
        artifact: {
          id,
          version: version ?? 2,
          status: 'saved',
          savedVersions: [version ?? 2],
          blueprint: BLUEPRINT,
        },
        rows,
      });
    },
    download: (id: string, version?: number) => {
      calls.push({ method: 'download', id, version });
      return Promise.resolve({
        filename: 'sales-v2.zip',
        archive: Buffer.from('PK-zip'),
      });
    },
  };
  const controller = new ArtifactsController(
    service as unknown as ArtifactsService,
  );
  return { controller, calls };
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

describe('ArtifactsController', () => {
  it('answers an artifact at the version asked for, drawn on its rows (api.md 145)', async () => {
    const { controller, calls } = build([
      { month: 'Jan', region: 'Europe', revenue: 10 },
    ]);
    const detail = await controller.get('a-1', '1');
    expect(calls).toEqual([{ method: 'detail', id: 'a-1', version: 1 }]);
    expect(detail.version).toBe(1);
    expect(detail.document).toContain('"live":true');
    expect(detail.document).toContain('"revenue":10');
  });

  it('answers the current version when none is asked for, on invented values without rows', async () => {
    const { controller, calls } = build(null);
    const detail = await controller.get('a-1');
    expect(calls).toEqual([
      { method: 'detail', id: 'a-1', version: undefined },
    ]);
    expect(detail.document).toContain('"mapping":null');
    expect(detail.document).not.toContain('"live":true');
    expect(detail.document).not.toContain('"rows":');
  });

  it('refuses a version that is not a positive whole number, and says when one is unknown', async () => {
    const { controller, calls } = build(null);
    for (const bad of ['0', 'x', '1.5', '-2']) {
      await expect(controller.get('a-1', bad)).rejects.toThrow(
        new BadRequestException('Version must be a positive whole number'),
      );
      const { res } = response();
      await expect(controller.download('a-1', res, bad)).rejects.toThrow(
        'Version must be a positive whole number',
      );
    }
    expect(calls).toEqual([]);
    await expect(controller.get('a-1', '9')).rejects.toThrow(
      'Artifact "a-1" has no version 9',
    );
  });

  it('downloads a version as a zip attachment (api.md 165)', async () => {
    const { controller, calls } = build(null);
    const { res, headers, body } = response();
    await controller.download('a-1', res, '2');
    expect(calls).toEqual([{ method: 'download', id: 'a-1', version: 2 }]);
    expect(headers).toEqual({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="sales-v2.zip"',
      'Content-Length': 6,
      'Cache-Control': 'no-store',
    });
    expect(body()).toEqual(Buffer.from('PK-zip'));
  });

  it('saves a version to Artifacts and answers the artifact at it (api.md 166)', async () => {
    const { controller, calls } = build([
      { month: 'Jan', region: 'Europe', revenue: 10 },
    ]);
    const saved = await controller.save('a-1', { version: 1 });
    expect(calls).toEqual([
      { method: 'save', id: 'a-1', body: { version: 1 } },
    ]);
    expect(saved).toMatchObject({
      version: 1,
      status: 'saved',
      savedVersions: [1],
    });
    expect(saved.document).toContain('"revenue":10');
  });
});
