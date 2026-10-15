import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const workspaces = mkdtempSync(join(tmpdir(), 'panel-items-'));
jest.mock('../../mastra/session-workspaces', () => ({
  sessionWorkspacePath: (sessionId: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('path') as typeof import('path')).join(
      workspaces,
      `session-${sessionId}`,
    ),
}));

import type { PanelItem, SessionDoc } from './entities/session.entity';
import {
  MAX_PANEL_ITEMS,
  buildPanelItem,
  latestPanelItem,
  tableCsv,
  titleSlug,
  upsertPanelItem,
  withVisualItems,
} from './panel-items';

const session: SessionDoc = {
  id: 's1',
  name: 'S',
  datasets: [],
  messages: [],
  visualizations: [
    {
      id: 'v1',
      title: 'Chart',
      description: '',
      path: 'visuals/v1',
      sourceMessageAt: 'a',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};
const base = { session };

const doc = (id: string, shownAt: string): PanelItem => ({
  id,
  kind: 'document',
  title: id,
  shownAt,
  markdown: 'm',
});

describe('upsertPanelItem', () => {
  it('replaces a visual item in place and appends the rest', () => {
    const visual = (shownAt: string): PanelItem => ({
      id: 'visual:v1',
      kind: 'visual',
      title: 'Chart',
      shownAt,
      visualId: 'v1',
    });
    let items = upsertPanelItem([], visual('1'));
    items = upsertPanelItem(items, doc('d1', '2'));
    items = upsertPanelItem(items, visual('3'));
    items = upsertPanelItem(items, doc('d2', '4'));
    expect(items.map((i) => `${i.id}@${i.shownAt}`)).toEqual([
      'visual:v1@3',
      'd1@2',
      'd2@4',
    ]);
    expect(latestPanelItem(items)?.id).toBe('d2');
  });

  it('keeps 100 items, dropping the oldest documents first and never a visual', () => {
    let items: PanelItem[] = [
      {
        id: 'visual:v0',
        kind: 'visual',
        title: 'Chart',
        shownAt: '000',
        visualId: 'v0',
      },
    ];
    for (let i = 0; i < MAX_PANEL_ITEMS + 5; i += 1) {
      items = upsertPanelItem(items, doc(`d${i}`, String(i).padStart(3, '0')));
    }
    expect(items).toHaveLength(MAX_PANEL_ITEMS);
    expect(items[0].id).toBe('visual:v0');
    expect(items.map((i) => i.id)).not.toContain('d0');
    expect(items.at(-1)?.id).toBe(`d${MAX_PANEL_ITEMS + 4}`);
  });
});

describe('withVisualItems', () => {
  it('synthesizes an item for a visual without one, stamped at its creation', () => {
    expect(withVisualItems(session)).toEqual([
      {
        id: 'visual:v1',
        kind: 'visual',
        title: 'Chart',
        shownAt: '2026-01-01T00:00:00.000Z',
        visualId: 'v1',
      },
    ]);
    const stored = { ...session, panelItems: [doc('d', '1')] };
    expect(withVisualItems(stored).map((i) => i.id)).toEqual([
      'd',
      'visual:v1',
    ]);
  });
});

describe('withVisualItems, retired phases items', () => {
  it('drops a stored phases item at read time', () => {
    const stored = {
      ...session,
      panelItems: [
        {
          id: 'phases',
          kind: 'phases',
          title: 'Workflow',
          shownAt: '1',
        },
        doc('d', '2'),
      ] as unknown as PanelItem[],
    };
    expect(withVisualItems(stored).map((i) => i.id)).toEqual([
      'd',
      'visual:v1',
    ]);
  });
});

describe('tableCsv', () => {
  it('quotes per RFC 4180 and writes nulls and objects', () => {
    expect(
      tableCsv(
        ['a', 'b'],
        [
          { a: 'x,y', b: null },
          { a: 'say "hi"', b: { n: 1 } },
        ],
      ),
    ).toBe('a,b\r\n"x,y",\r\n"say ""hi""","{""n"":1}"');
    expect(titleSlug('Top 5 — Scorers!')).toBe('top-5-scorers');
  });
});

describe('buildPanelItem', () => {
  it('builds a document with its default title and limit', async () => {
    const { item, summary } = await buildPanelItem(
      { kind: 'document', markdown: '# Hi' },
      base,
    );
    expect(item).toMatchObject({ kind: 'document', title: 'Document' });
    expect(summary).toMatchObject({ shown: true, kind: 'document' });
    await expect(
      buildPanelItem({ kind: 'document', markdown: 'x'.repeat(50_001) }, base),
    ).rejects.toThrow('The document is at most 50,000 characters');
    await expect(buildPanelItem({ kind: 'document' }, base)).rejects.toThrow(
      'markdown is required for kind "document"',
    );
  });

  it('picks a table from the turn: the latest by default, a numbered one on request', async () => {
    const records = [
      {
        tool: 'run_readonly_sql',
        input: 'q1',
        columns: ['a'],
        rows: [{ a: 1 }],
      },
      { tool: 'run_readonly_sql', input: 'bad', error: 'boom' },
      {
        tool: 'run_readonly_sql',
        input: 'q2',
        columns: ['b'],
        rows: [{ b: 2 }],
        rowCount: 500,
      },
    ];
    const latest = await buildPanelItem(
      { kind: 'table' },
      { ...base, turnRecords: records },
    );
    expect(latest.item).toMatchObject({
      input: 'q2',
      rowCount: 500,
      truncated: true,
      title: 'run_readonly_sql result',
    });
    const first = await buildPanelItem(
      { kind: 'table', record: 1, title: ' Mine ' },
      { ...base, turnRecords: records },
    );
    expect(first.item).toMatchObject({ input: 'q1', title: 'Mine' });
    expect(first.item).not.toHaveProperty('truncated');
  });

  it('re-stamps a visual under its fixed id', async () => {
    const { item } = await buildPanelItem(
      { kind: 'visual', visualId: 'v1' },
      base,
    );
    expect(item).toMatchObject({ id: 'visual:v1', title: 'Chart' });
  });

  describe('files', () => {
    const folder = join(workspaces, 'session-s1');
    beforeAll(() => {
      mkdirSync(join(folder, 'rfp', 'x'), { recursive: true });
      writeFileSync(join(folder, 'rfp', 'x', 'rfp.md'), '# RFP');
      writeFileSync(join(folder, 'pic.png'), 'png');
      writeFileSync(join(folder, 'big.txt'), 'a'.repeat(256 * 1024 + 1));
      writeFileSync(join(workspaces, 'secret.md'), 'secret');
      symlinkSync(join(workspaces, 'secret.md'), join(folder, 'link.md'));
    });
    const show = (path?: string) =>
      buildPanelItem({ kind: 'file', path }, base);

    it('shows a text file of the workspace', async () => {
      const { item, summary } = await show('rfp/x/rfp.md');
      expect(item).toMatchObject({
        kind: 'file',
        title: 'rfp.md',
        path: 'rfp/x/rfp.md',
        bytes: 5,
      });
      expect(summary.bytes).toBe(5);
    });

    it('refuses with the contract messages', async () => {
      await expect(show()).rejects.toThrow('path is required for kind "file"');
      for (const bad of ['../secret.md', '/etc/passwd', 'a//b.md', 'link.md']) {
        await expect(show(bad)).rejects.toThrow(`Invalid file path "${bad}"`);
      }
      await expect(show('nope.md')).rejects.toThrow(
        'File "nope.md" not found in the session workspace',
      );
      await expect(show('pic.png')).rejects.toThrow(
        'File "pic.png" is not a text file: show .md, .txt, .csv, .json, .sql, .yaml, .yml or .log files',
      );
      await expect(show('big.txt')).rejects.toThrow(
        'File "big.txt" is larger than 256 KB',
      );
    });
  });
});
