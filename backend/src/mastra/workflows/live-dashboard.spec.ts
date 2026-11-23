import { Script, createContext, runInContext } from 'node:vm';
import { standaloneFrameCss } from '../../modules/sessions/frame-theme';
import {
  dashboardArchive,
  dashboardSlug,
  renderLiveDashboardBundle,
  type DashboardRow,
} from './live-dashboard';
import {
  DASHBOARD_MOCK_CSS,
  DASHBOARD_MOCK_ROOT_ID,
  DASHBOARD_MOCK_RUNTIME,
} from './recreate-dashboard.runtime';
import type { DashboardBlueprint } from './recreate-dashboard.steps';

/** A World Cup dashboard as a live version holds it. */
const BLUEPRINT: DashboardBlueprint = {
  title: 'Goals by team',
  summary: 'Goals scored by each team in each tournament.',
  theme: { mode: 'light', accent: '#3b6cf6', palette: [] },
  layout: 'Filters on top, then a KPI and two charts.',
  filters: [
    {
      id: 'stage',
      label: 'Stage',
      kind: 'select',
      column: 'stage',
      options: ['Group', 'Final'],
    },
    {
      id: 'tournament',
      label: 'Tournament',
      kind: 'select',
      column: 'tournament',
      options: ['2018', '2022'],
    },
  ],
  widgets: [
    {
      id: 'total-goals',
      title: 'Total goals',
      kind: 'kpi',
      span: 4,
      measures: [
        {
          label: 'Goals',
          column: 'goals',
          aggregation: 'sum',
          format: 'number',
          unit: '',
          total: null,
        },
      ],
      dimension: '',
      description: '',
      observed: '',
      filteredBy: ['stage', 'tournament'],
    },
    {
      id: 'goals-by-team',
      title: 'Goals by team',
      kind: 'bar',
      span: 8,
      measures: [
        {
          label: 'Goals',
          column: 'goals',
          aggregation: 'sum',
          format: 'number',
          unit: '',
          total: null,
        },
      ],
      dimension: 'team',
      description: '',
      observed: '',
      filteredBy: ['stage'],
    },
    {
      id: 'matches-by-date',
      title: 'Matches by date',
      kind: 'table',
      span: 6,
      measures: [
        {
          label: 'Matches',
          column: '',
          aggregation: 'count',
          format: 'number',
          unit: '',
          total: null,
        },
      ],
      dimension: 'played_on',
      description: '',
      observed: '',
      filteredBy: [],
    },
    {
      id: 'note',
      title: 'Note',
      kind: 'text',
      span: 6,
      measures: [],
      dimension: '',
      description: '',
      observed: '',
      filteredBy: [],
    },
  ],
  columns: [
    {
      name: 'team',
      type: 'string',
      description: '',
      values: [],
      min: null,
      max: null,
    },
    {
      name: 'tournament',
      type: 'string',
      description: '',
      values: [],
      min: null,
      max: null,
    },
    {
      name: 'stage',
      type: 'string',
      description: '',
      values: [],
      min: null,
      max: null,
    },
    {
      name: 'played_on',
      type: 'date',
      description: '',
      values: [],
      min: null,
      max: null,
    },
    {
      name: 'goals',
      type: 'number',
      description: '',
      values: [],
      min: null,
      max: null,
    },
  ],
};

/** Real rows, numbers already numbers (the caller converts them). */
const ROWS: DashboardRow[] = [
  {
    team: 'France',
    tournament: '2018',
    stage: 'Final',
    played_on: '2018-07-15',
    goals: 4,
  },
  {
    team: 'Croatia',
    tournament: '2018',
    stage: 'Final',
    played_on: '2018-07-15',
    goals: 2,
  },
  {
    team: 'France',
    tournament: '2018',
    stage: 'Group',
    played_on: '2018-06-16',
    goals: 2,
  },
  {
    team: 'Argentina',
    tournament: '2022',
    stage: 'Final',
    played_on: '2022-12-18',
    goals: 3,
  },
  {
    team: 'France',
    tournament: '2022',
    stage: 'Final',
    played_on: '2022-12-18',
    goals: 3,
  },
  {
    team: 'Argentina',
    tournament: '2022',
    stage: 'Group',
    played_on: '2022-11-22',
    goals: 1,
  },
  {
    team: null,
    tournament: '2022',
    stage: 'Group',
    played_on: '2022-11-22',
    goals: null,
  },
];

interface DashMock {
  compute(
    blueprint: unknown,
    rows: unknown,
    state: Record<string, string>,
    live?: boolean,
  ): {
    id: string;
    rowCount: number;
    totals: number[];
    groups: { key: string; values: number[] }[];
  }[];
  mount(root: unknown, input: unknown): void;
}

/** Just enough of a DOM for the runtime to draw into. */
class FakeNode {
  children: FakeNode[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, (() => void)[]> = {};
  style: Record<string, unknown> = { setProperty: () => undefined };
  classList = { add: () => undefined };
  className = '';
  hidden = false;
  type = '';
  value = '';
  title = '';
  private text = '';
  constructor(readonly tagName: string) {}
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    this.children = this.children.filter((node) => node !== child);
    return child;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value);
  }
  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  get textContent(): string {
    return (
      this.text + this.children.map((child) => child.textContent).join(' ')
    );
  }
  set textContent(value: string) {
    this.text = String(value);
    this.children = [];
  }
  /** Every node below this one, depth first. */
  all(): FakeNode[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
}

/** The runtime loaded as a page loads it, with a fake document. */
function runtime(): DashMock {
  const window: { dashMock?: DashMock } = {};
  const document = {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => {
      const node = new FakeNode('#text');
      node.textContent = text;
      return node;
    },
  };
  runInContext(DASHBOARD_MOCK_RUNTIME, createContext({ window, document }));
  return window.dashMock as DashMock;
}

describe('the fixed runtime on live rows', () => {
  const dash = runtime();

  it('folds the real rows, and the filters recompute the widgets they filter', () => {
    const all = dash.compute(BLUEPRINT, ROWS, {}, true);
    expect(all[0].totals[0]).toBe(15);
    expect(all[0].rowCount).toBe(7);
    const finals = dash.compute(BLUEPRINT, ROWS, { stage: 'Final' }, true);
    expect(finals[0].totals[0]).toBe(12);
    expect(finals[1].groups).toEqual([
      { key: 'France', values: [7] },
      { key: 'Croatia', values: [2] },
      { key: 'Argentina', values: [3] },
    ]);
    // The table is not filtered by Stage.
    expect(finals[2]).toEqual(all[2]);
    const final2022 = dash.compute(
      BLUEPRINT,
      ROWS,
      { stage: 'Final', tournament: '2022' },
      true,
    );
    expect(final2022[0].totals[0]).toBe(6);
  });

  it('groups by the values the rows hold: dates ascending, an empty value as (blank)', () => {
    const [, byTeam, byDate] = dash.compute(BLUEPRINT, ROWS, {}, true);
    expect(byTeam.groups.map((group) => group.key)).toEqual([
      'France',
      'Croatia',
      'Argentina',
      '(blank)',
    ]);
    expect(byDate.groups).toEqual([
      { key: '2018-06-16', values: [1] },
      { key: '2018-07-15', values: [2] },
      { key: '2022-11-22', values: [2] },
      { key: '2022-12-18', values: [2] },
    ]);
  });

  it('draws the given rows and never says the values are invented', () => {
    const root = new FakeNode('div');
    dash.mount(root, {
      blueprint: BLUEPRINT,
      mapping: null,
      rows: ROWS,
      live: true,
    });
    expect(root.attributes['data-data']).toBe('live');
    const text = root.textContent;
    expect(text).not.toMatch(/invented|mock/i);
    const kpi = root.all().find((node) => node.className === 'dmk-kpi-value');
    expect(kpi?.textContent).toBe('15');
    // Changing a filter draws the widget again from the filtered rows.
    const select = root
      .all()
      .find((node) => node.tagName === 'select') as FakeNode;
    select.value = 'Final';
    select.listeners['change'].forEach((listener) => listener());
    const after = root.all().find((node) => node.className === 'dmk-kpi-value');
    expect(after?.textContent).toBe('12');
  });

  it('still draws the mock without rows', () => {
    const root = new FakeNode('div');
    dash.mount(root, { blueprint: BLUEPRINT, mapping: null });
    expect(root.attributes['data-data']).toBe('mock');
    const note = root.all().find((node) => node.className === 'dmk-note');
    expect(note?.textContent).toBe('This widget is not drawn in the mock.');
  });
});

describe('renderLiveDashboardBundle', () => {
  it('is the fixed runtime with the rows as data', () => {
    const bundle = renderLiveDashboardBundle(BLUEPRINT, ROWS);
    expect(bundle.title).toBe('Goals by team');
    expect(bundle.html).toBe(
      `<div id="${DASHBOARD_MOCK_ROOT_ID}" class="dmk"></div>`,
    );
    expect(bundle.css).toBe(DASHBOARD_MOCK_CSS);
    expect(bundle.javascript.startsWith(DASHBOARD_MOCK_RUNTIME)).toBe(true);
    expect(bundle.javascript).toContain('"live":true');
    expect(bundle.javascript).toContain('"team":"Croatia"');
    expect(() => new Script(bundle.javascript)).not.toThrow();
    expect(bundle.description).toBe(
      'Goals scored by each team in each tournament. Drawn from 7 rows of your data. The filters recompute the widgets they filter.',
    );
    expect(bundle.description).not.toMatch(/invented/);
  });

  it("draws today's mock without rows", () => {
    const bundle = renderLiveDashboardBundle(BLUEPRINT, null);
    expect(bundle.javascript).not.toContain('"live":true');
    expect(bundle.description).toContain('Every value shown is invented.');
  });

  it('cannot be broken out of by a value', () => {
    const bundle = renderLiveDashboardBundle(BLUEPRINT, [
      { team: '</script><script>alert(1)</script>', goals: 1 },
    ]);
    expect(bundle.javascript).not.toContain('</script>');
    expect(() => new Script(bundle.javascript)).not.toThrow();
  });
});

describe('dashboardArchive', () => {
  const entriesOf = (archive: ReturnType<typeof dashboardArchive>) =>
    Object.fromEntries(
      archive.entries.map((entry) => [entry.name, String(entry.data)]),
    );

  const live = dashboardArchive({
    id: '0f9a1c2e-1111-2222-3333-444455556666',
    name: 'Goals by Team & Tournament',
    version: 2,
    blueprint: BLUEPRINT,
    rows: ROWS,
    query: {
      sql: 'SELECT team, tournament, stage, played_on, goals FROM goals',
      datasourceId: 'ds-1',
    },
    createdAt: '2026-11-22T10:00:00.000Z',
  });
  const files = entriesOf(live);

  it('names the zip after the artifact and its version', () => {
    expect(live.filename).toBe('goals-by-team-tournament-v2.zip');
    expect(live.entries.map((entry) => entry.name)).toEqual([
      'index.html',
      'styles.css',
      'app.js',
      'data.js',
      'query.sql',
      'README.txt',
    ]);
    expect(dashboardSlug('Ñandú · Résumé!!')).toBe('nandu-resume');
    expect(dashboardSlug('x'.repeat(80))).toHaveLength(64);
    expect(
      dashboardArchive({
        id: '0f9a1c2e-1111',
        name: '¿?',
        version: 1,
        blueprint: BLUEPRINT,
        rows: null,
        createdAt: '2026-11-22T10:00:00.000Z',
      }).filename,
    ).toBe('dashboard-0f9a1c2e-v1.zip');
  });

  it('is a plain page: relative links, no CDN, no inline script, no CSP', () => {
    const html = files['index.html'];
    expect(html).toContain('<link rel="stylesheet" href="styles.css">');
    expect(html).toContain(
      '<script src="data.js"></script><script src="app.js"></script>',
    );
    expect(html).toContain(
      `<div id="${DASHBOARD_MOCK_ROOT_ID}" class="dmk"></div>`,
    );
    expect(html).toContain('<title>Goals by Team &amp; Tournament</title>');
    expect(html).toContain('Goals scored by each team in each tournament.');
    expect(html).toContain('Version 2 · 22 Nov 2026 · 7 rows');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>[^<]/);
    expect(html).not.toMatch(/Content-Security-Policy/i);
    expect(files['styles.css'].startsWith(standaloneFrameCss())).toBe(true);
    expect(files['styles.css']).toContain(DASHBOARD_MOCK_CSS);
    expect(files['app.js']).toBe(
      `${DASHBOARD_MOCK_RUNTIME}\nwindow.dashMock.mount(document.getElementById(${JSON.stringify(DASHBOARD_MOCK_ROOT_ID)}), window.DASHBOARD_DATA);\n`,
    );
    expect(files['query.sql']).toContain('SELECT team, tournament');
    expect(files['README.txt']).toContain('index.html');
    expect(files['README.txt']).toContain('Version 2');
    expect(files['README.txt']).toContain('7 rows');
    expect(files['README.txt']).not.toMatch(/invented/);
  });

  it('carries the rows as escaped JSON that the page runs', () => {
    const hostile = dashboardArchive({
      name: 'x',
      version: 1,
      blueprint: { ...BLUEPRINT, title: '</script><b>t</b>' },
      rows: [{ team: `a</script>b${String.fromCharCode(0x2028)}c`, goals: 1 }],
      createdAt: '2026-11-22T10:00:00.000Z',
    });
    const data = entriesOf(hostile)['data.js'];
    expect(data.startsWith('window.DASHBOARD_DATA = ')).toBe(true);
    expect(data).not.toContain('</script>');
    expect(data).not.toContain(String.fromCharCode(0x2028));
    const window: { DASHBOARD_DATA?: { rows: DashboardRow[]; live: boolean } } =
      {};
    runInContext(data, createContext({ window }));
    expect(window.DASHBOARD_DATA?.live).toBe(true);
    expect(window.DASHBOARD_DATA?.rows[0].team).toBe(
      `a</script>b${String.fromCharCode(0x2028)}c`,
    );
    // The page title is text, not markup.
    expect(entriesOf(hostile)['index.html']).not.toContain('<b>t</b>');
  });

  it('says a version without data is drawn on invented values', () => {
    const mock = dashboardArchive({
      name: 'Old one',
      version: 1,
      blueprint: BLUEPRINT,
      rows: null,
      createdAt: '2026-01-05T10:00:00.000Z',
    });
    const mockFiles = entriesOf(mock);
    expect(mock.entries.map((entry) => entry.name)).toEqual([
      'index.html',
      'styles.css',
      'app.js',
      'data.js',
      'README.txt',
    ]);
    expect(mockFiles['README.txt']).toMatch(/values are invented/);
    expect(mockFiles['index.html']).toContain(
      'Version 1 · 5 Jan 2026 · invented data',
    );
    expect(mockFiles['data.js']).toContain('"live":false');
  });
});
