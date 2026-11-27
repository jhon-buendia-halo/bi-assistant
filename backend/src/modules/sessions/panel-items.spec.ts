import type { PanelItem, SessionDoc } from './entities/session.entity';
import {
  MAX_PANEL_ITEMS,
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
