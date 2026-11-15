import {
  RECREATE_DASHBOARD_EDGES,
  RECREATE_DASHBOARD_STEPS,
  blueprintOf,
  mockBundleOf,
  mockCodeBytes,
  recreateDashboardQuestion,
  savedMock,
  savedMockAnswer,
  RECREATE_DASHBOARD_DEFAULT_QUESTION,
} from './recreate-dashboard.steps';

const REPLY = {
  title: 'Sales Performance 2025',
  summary: 'Tracks revenue by month, channel and region.',
  theme: 'light, accent #3b6cf6',
  layout: 'Row 1: four KPI tiles. Row 2: bar chart and donut.',
  filters: [
    {
      id: 'Region',
      label: 'Region',
      kind: 'select',
      options: ['All regions', 'Europe'],
    },
    { label: 'Channel', kind: 'dropdown', options: ['Online', 7, ''] },
  ],
  widgets: [
    {
      id: 'revenue',
      title: 'Revenue',
      kind: 'KPI',
      position: 'row 1, col 1',
      description: 'Total revenue',
      fields: ['revenue'],
      observed: '$1.07M, +9.8%',
      filteredBy: ['Region', 'missing'],
    },
    { title: 'Revenue', kind: 'sparkles' },
  ],
  columns: [
    { name: 'revenue', type: 'number', description: 'Order revenue' },
    { name: '', type: 'string' },
    { name: 'region', type: 'category' },
  ],
};

describe('blueprintOf', () => {
  it('reads a reply leniently into a valid blueprint', () => {
    const blueprint = blueprintOf(REPLY);
    expect(blueprint).toBeDefined();
    expect(blueprint?.title).toBe('Sales Performance 2025');
    // Ids are kebab-case and unique; an unknown kind is `other`.
    expect(blueprint?.filters).toEqual([
      {
        id: 'region',
        label: 'Region',
        kind: 'select',
        options: ['All regions', 'Europe'],
      },
      { id: 'channel', label: 'Channel', kind: 'other', options: ['Online'] },
    ]);
    expect(blueprint?.widgets.map((widget) => widget.id)).toEqual([
      'revenue',
      'revenue-2',
    ]);
    expect(blueprint?.widgets.map((widget) => widget.kind)).toEqual([
      'kpi',
      'other',
    ]);
    // A widget names a filter by the id the model gave it; unknown ids go.
    expect(blueprint?.widgets[0].filteredBy).toEqual(['region']);
    expect(blueprint?.widgets[1]).toMatchObject({
      position: '',
      fields: [],
      filteredBy: [],
    });
    // A column without a name is dropped; an unknown type is a string.
    expect(blueprint?.columns).toEqual([
      { name: 'revenue', type: 'number', description: 'Order revenue' },
      { name: 'region', type: 'string', description: '' },
    ]);
  });

  it('reads the JSON object out of a text reply', () => {
    const blueprint = blueprintOf(
      `Here it is:\n${JSON.stringify(REPLY)}\nDone.`,
    );
    expect(blueprint?.widgets).toHaveLength(2);
  });

  it('is undefined when the reply names no widget or is no JSON', () => {
    expect(blueprintOf({ ...REPLY, widgets: [] })).toBeUndefined();
    expect(blueprintOf('I cannot see a dashboard.')).toBeUndefined();
    expect(blueprintOf(undefined)).toBeUndefined();
  });
});

const BLUEPRINT = { title: 'Sales', summary: 'Sales by month.' };

const MOCK_REPLY = [
  'TITLE: Sales Performance 2025',
  'DESCRIPTION: Filter by region; hover a bar for its value.',
  '```html',
  '<div class="mock"><svg></svg></div>',
  '```',
  '```css',
  '.mock { display: grid; }',
  '```',
  '```javascript',
  'const note = "```";',
  'render();',
  '```',
].join('\n');

describe('mockBundleOf', () => {
  it('reads the title, the description and the three fenced blocks', () => {
    expect(mockBundleOf(MOCK_REPLY, BLUEPRINT)).toEqual({
      title: 'Sales Performance 2025',
      description: 'Filter by region; hover a bar for its value.',
      html: '<div class="mock"><svg></svg></div>',
      css: '.mock { display: grid; }',
      javascript: 'const note = "```";\nrender();',
    });
  });

  it("falls back to the blueprint's title and summary, and an empty sheet", () => {
    const reply = '```html\n<p>x</p>\n```\n```js\nrun();\n```';
    expect(mockBundleOf(reply, BLUEPRINT)).toEqual({
      title: 'Sales',
      description: 'Sales by month.',
      html: '<p>x</p>',
      css: '',
      javascript: 'run();',
    });
  });

  it('reads a reply cut off inside its script', () => {
    const reply = '```html\n<p>x</p>\n```\n```javascript\nconst a = 1;';
    expect(mockBundleOf(reply, BLUEPRINT)?.javascript).toBe('const a = 1;');
  });

  it('is undefined without HTML or without JavaScript', () => {
    expect(mockBundleOf('```html\n<p>x</p>\n```', BLUEPRINT)).toBeUndefined();
    expect(mockBundleOf('```javascript\nx();\n```', BLUEPRINT)).toBeUndefined();
    expect(mockBundleOf('Sorry, I cannot.', BLUEPRINT)).toBeUndefined();
  });

  it('counts the code in bytes of UTF-8', () => {
    expect(
      mockCodeBytes({
        title: 't',
        description: 'd',
        html: 'é',
        css: 'a',
        javascript: 'b',
      }),
    ).toBe(4);
  });
});

describe('the run result', () => {
  const blueprint = blueprintOf(REPLY)!;

  it('uses the default instructions when none are given', () => {
    expect(recreateDashboardQuestion('  ')).toBe(
      RECREATE_DASHBOARD_DEFAULT_QUESTION,
    );
    expect(recreateDashboardQuestion(' Dark theme ')).toBe('Dark theme');
  });

  it('says what the mock recreates and that its data is invented', () => {
    const answer = savedMockAnswer({ title: 'Sales', blueprint });
    expect(answer).toContain(
      'Recreated **Sales** as an interactive mock with 2 widgets and 2 filters.',
    );
    expect(answer).toContain('- **Revenue** (kpi)');
    expect(answer).toContain('Every value in the mock is invented');
  });

  it('leaves the filters out of the answer when there are none', () => {
    const answer = savedMockAnswer({
      title: 'Sales',
      blueprint: {
        ...blueprint,
        filters: [],
        widgets: blueprint.widgets.slice(0, 1),
      },
    });
    expect(answer).toContain('with 1 widget.');
  });

  it("is Save mock's output", () => {
    expect(savedMock({ visualId: 'v-1', title: 'Sales', blueprint })).toEqual({
      visualId: 'v-1',
      title: 'Sales',
      widgetCount: 2,
      filterCount: 2,
      answer: savedMockAnswer({ title: 'Sales', blueprint }),
      blueprint,
    });
  });
});

describe('the catalogue', () => {
  it('connects every step from Start to End in order', () => {
    const ids = RECREATE_DASHBOARD_STEPS.map((step) => step.id);
    expect(ids).toEqual([
      'load-image',
      'read-dashboard',
      'build-mock',
      'save-mock',
    ]);
    expect(RECREATE_DASHBOARD_EDGES.map((edge) => edge.from)).toEqual([
      'start',
      ...ids,
    ]);
    expect(RECREATE_DASHBOARD_EDGES.map((edge) => edge.to)).toEqual([
      ...ids,
      'end',
    ]);
  });

  it('has two agent steps, each one model call without tools', () => {
    expect(
      RECREATE_DASHBOARD_STEPS.filter((step) => step.kind === 'agent').map(
        (step) => [step.id, step.modelOnly],
      ),
    ).toEqual([
      ['read-dashboard', true],
      ['build-mock', true],
    ]);
  });
});
