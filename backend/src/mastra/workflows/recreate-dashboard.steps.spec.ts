import { Script, createContext, runInContext } from 'node:vm';
import {
  DASHBOARD_MOCK_ROOT_ID,
  DASHBOARD_MOCK_ROWS,
  DASHBOARD_MOCK_RUNTIME,
} from './recreate-dashboard.runtime';
import {
  SAMPLE_BLUEPRINT_REPLY,
  SAMPLE_CATALOG,
  SAMPLE_COLUMNS,
  SAMPLE_MAPPING_REPLY,
} from './recreate-dashboard.sample';
import {
  NO_SOURCE_NOTE,
  RECREATE_DASHBOARD_DEFAULT_QUESTION,
  RECREATE_DASHBOARD_EDGES,
  RECREATE_DASHBOARD_STEPS,
  blueprintOf,
  mappingCounts,
  mappingExplanation,
  mappingOf,
  recreateDashboardQuestion,
  renderDashboardBundle,
  renderedDashboard,
  widgetFields,
  type DashboardBlueprint,
} from './recreate-dashboard.steps';

const blueprint = blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint;
const mapping = mappingOf(
  SAMPLE_MAPPING_REPLY,
  blueprint,
  SAMPLE_CATALOG,
  SAMPLE_COLUMNS,
);

describe('blueprintOf', () => {
  it('reads a reply leniently into a valid blueprint', () => {
    expect(blueprint.title).toBe('Sales Performance 2025');
    // A colour that is no hex value is dropped; hex is lower-cased.
    expect(blueprint.theme).toEqual({
      mode: 'light',
      accent: '#3b6cf6',
      palette: ['#3b6cf6'],
    });
    // Ids are kebab-case and unique; an unknown kind is `other`.
    expect(blueprint.filters).toEqual([
      {
        id: 'region',
        label: 'Region',
        kind: 'select',
        column: 'region',
        options: ['All regions', 'North America', 'Europe'],
      },
      {
        id: 'channel',
        label: 'Channel',
        kind: 'other',
        column: 'channel',
        options: ['7'],
      },
    ]);
    expect(
      blueprint.widgets.map((widget) => [widget.id, widget.kind, widget.span]),
    ).toEqual([
      ['revenue', 'kpi', 3],
      ['revenue-2', 'other', 12],
      ['monthly', 'bar', 4],
      ['by-region', 'table', 12],
    ]);
    // A widget names a filter by the id the model gave it; unknown ids go.
    expect(blueprint.widgets[0].filteredBy).toEqual(['region']);
  });

  it('keeps a measure only with a column, with defaults for the rest', () => {
    expect(blueprint.widgets[1].measures).toEqual([
      {
        label: 'return_rate',
        column: 'return_rate',
        aggregation: 'sum',
        format: 'percent',
        unit: '',
        total: null,
      },
    ]);
    expect(blueprint.widgets[0].measures[0].total).toBe(1070000);
  });

  it('lists every column the dashboard reads, adding the ones left out', () => {
    expect(
      blueprint.columns.map((column) => [column.name, column.type]),
    ).toEqual([
      ['month', 'date'],
      ['region', 'string'],
      ['revenue', 'number'],
      // A column a measure folds is a number; one with no name is dropped.
      ['return_rate', 'number'],
      // The Channel filter's column was not listed.
      ['channel', 'string'],
    ]);
    expect(blueprint.columns[2]).toMatchObject({ min: 1000, max: 6000 });
    expect(blueprint.columns[0].values).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('reads the JSON object out of a text reply', () => {
    const read = blueprintOf(
      `Here it is:\n${JSON.stringify(SAMPLE_BLUEPRINT_REPLY)}\nDone.`,
    );
    expect(read?.widgets).toHaveLength(4);
  });

  it('is undefined when the reply names no widget or is no JSON', () => {
    expect(
      blueprintOf({ ...SAMPLE_BLUEPRINT_REPLY, widgets: [] }),
    ).toBeUndefined();
    expect(blueprintOf('I cannot see a dashboard.')).toBeUndefined();
    expect(blueprintOf(undefined)).toBeUndefined();
  });

  it('names the columns a widget reads, each once', () => {
    expect(blueprint.widgets.map(widgetFields)).toEqual([
      ['revenue'],
      ['return_rate'],
      ['revenue', 'month'],
      ['revenue', 'region'],
    ]);
  });
});

describe('mappingOf', () => {
  it('counts each status from the checked fields, never from the reply', () => {
    expect(
      mapping.widgets.map((widget) => [widget.widgetId, widget.status]),
    ).toEqual([
      // The reply said `unmapped`; its one field has a source.
      ['revenue', 'mapped'],
      ['revenue-2', 'unmapped'],
      ['monthly', 'mapped'],
      // `shop.orders.area` is not in the catalog.
      ['by-region', 'partial'],
    ]);
    expect(mappingCounts(mapping)).toEqual({
      mapped: 2,
      partial: 1,
      unmapped: 1,
    });
  });

  it("keeps a source only when the catalog has it, in the catalog's spelling", () => {
    expect(mapping.widgets[2].fields).toEqual([
      {
        field: 'revenue',
        dataset: 'Shop',
        entity: 'shop.orders',
        column: 'total_amount',
        note: '',
      },
      {
        field: 'month',
        dataset: 'Shop',
        entity: 'shop.orders',
        column: 'order_date',
        note: 'Truncated to the month.',
      },
    ]);
    expect(mapping.widgets[3].fields[1]).toEqual({
      field: 'region',
      dataset: '',
      entity: '',
      column: '',
      note: 'Proposed shop.orders.area is not in the catalog.',
    });
    expect(mapping.widgets[1].fields[0].note).toBe(
      'No column records returns.',
    );
  });

  it('maps each filter by its column', () => {
    expect(mapping.filters).toEqual([
      {
        filterId: 'region',
        status: 'mapped',
        field: {
          field: 'region',
          dataset: 'Shop',
          entity: 'shop.orders',
          column: 'Region',
          note: '',
        },
      },
      {
        filterId: 'channel',
        status: 'unmapped',
        field: {
          field: 'channel',
          dataset: '',
          entity: '',
          column: '',
          note: 'Proposed shop.orders.sales_channel is not in the catalog.',
        },
      },
    ]);
  });

  it('writes a reason when the reply gives none, and keeps the gaps', () => {
    expect(mapping.widgets[2].reason).toBe(
      'Every column it reads has a source.',
    );
    expect(mapping.widgets[0].reason).toBe(
      'Sum of total_amount over shop.orders.',
    );
    expect(mapping.gaps).toEqual(['Returns: add a returned flag.']);
    expect(mapping.approach).toBe(
      'Everything rests on shop.orders, one row per order.',
    );
  });

  it('maps nothing from a reply that is no JSON object', () => {
    const none = mappingOf(
      'I could not do it.',
      blueprint,
      SAMPLE_CATALOG,
      SAMPLE_COLUMNS,
    );
    expect(mappingCounts(none)).toEqual({ mapped: 0, partial: 0, unmapped: 4 });
    expect(none.widgets[0].fields[0].note).toBe(NO_SOURCE_NOTE);
    expect(none.widgets[0].reason).toBe('No source for revenue.');
  });
});

interface DashMock {
  buildRows(blueprint: unknown): Record<string, string | number>[];
  compute(
    blueprint: unknown,
    rows: unknown,
    state: Record<string, string>,
  ): {
    id: string;
    rowCount: number;
    totals: number[];
    groups: { key: string; values: number[] }[];
  }[];
  formatValue(value: number, measure: unknown, exact: boolean): string;
}

/** The runtime's pure functions, loaded as the page loads it, with no DOM. */
function dashMock(): DashMock {
  const window: { dashMock?: DashMock } = {};
  runInContext(DASHBOARD_MOCK_RUNTIME, createContext({ window }));
  return window.dashMock as DashMock;
}

describe('the fixed runtime', () => {
  const runtime = dashMock();
  const rows = runtime.buildRows(blueprint);

  it('builds the same rows every time, with every column', () => {
    expect(rows).toHaveLength(DASHBOARD_MOCK_ROWS);
    expect(runtime.buildRows(blueprint)).toEqual(rows);
    expect(Object.keys(rows[0])).toEqual(
      blueprint.columns.map((column) => column.name),
    );
    expect(new Set(rows.map((row) => row['month']))).toEqual(
      new Set(['Jan', 'Feb', 'Mar']),
    );
    // A filter's options are its column's values, so each selects rows.
    expect(new Set(rows.map((row) => row['region']))).toEqual(
      new Set(['North America', 'Europe']),
    );
  });

  it('meets the total the image shows', () => {
    const [revenue] = runtime.compute(blueprint, rows, {});
    expect(revenue.totals[0]).toBeCloseTo(1070000, 3);
  });

  it('recomputes the widgets a filter filters, and only those', () => {
    const all = runtime.compute(blueprint, rows, {});
    const europe = runtime.compute(blueprint, rows, { region: 'Europe' });
    expect(europe[0].totals[0]).toBeLessThan(all[0].totals[0]);
    expect(europe[0].rowCount).toBeLessThan(all[0].rowCount);
    // The table is not filtered by Region.
    expect(europe[3]).toEqual(all[3]);
    // The parts add up to the whole.
    const northAmerica = runtime.compute(blueprint, rows, {
      region: 'North America',
    });
    expect(europe[0].totals[0] + northAmerica[0].totals[0]).toBeCloseTo(
      all[0].totals[0],
      3,
    );
  });

  it("groups by the dimension in the column's order", () => {
    const all = runtime.compute(blueprint, rows, {});
    expect(all[2].groups.map((group) => group.key)).toEqual([
      'Jan',
      'Feb',
      'Mar',
    ]);
    expect(
      all[2].groups.reduce((sum, group) => sum + group.values[0], 0),
    ).toBeCloseTo(all[0].totals[0], 3);
  });

  it('writes values for reading', () => {
    const currency = { format: 'currency', unit: '$' };
    expect(runtime.formatValue(1070000, currency, false)).toBe('$1.07M');
    expect(runtime.formatValue(301120, currency, true)).toBe('$301,120');
    expect(runtime.formatValue(0.031, { format: 'percent' }, false)).toBe(
      '3.1%',
    );
    expect(runtime.formatValue(3.1, { format: 'percent' }, false)).toBe('3.1%');
    expect(runtime.formatValue(18240, { format: 'number' }, false)).toBe(
      '18,240',
    );
    // A total that is whole but for rounding error reads as whole.
    const sum = { format: 'number', aggregation: 'sum' };
    expect(runtime.formatValue(64.0000001, sum, false)).toBe('64');
    expect(runtime.formatValue(43.7, sum, true)).toBe('44');
    expect(
      runtime.formatValue(
        58.6,
        { format: 'number', aggregation: 'avg' },
        false,
      ),
    ).toBe('58.60');
    // A currency symbol leads the figure, and round figures drop zeros.
    expect(
      runtime.formatValue(929000000, { format: 'compact', unit: '$' }, false),
    ).toBe('$929M');
    expect(
      runtime.formatValue(5e9, { format: 'compact', unit: '' }, false),
    ).toBe('5B');
    expect(
      runtime.formatValue(120, { format: 'number', unit: 'km' }, false),
    ).toBe('120 km');
  });
});

describe('renderDashboardBundle', () => {
  const bundle = renderDashboardBundle(blueprint, mapping);

  it('is the fixed runtime with the blueprint and mapping as data', () => {
    expect(bundle.title).toBe('Sales Performance 2025');
    expect(bundle.html).toBe(
      `<div id="${DASHBOARD_MOCK_ROOT_ID}" class="dmk"></div>`,
    );
    expect(bundle.javascript.startsWith(DASHBOARD_MOCK_RUNTIME)).toBe(true);
    expect(bundle.javascript).toContain('"widgetId":"revenue-2"');
    // Compiled, never run: the script parses.
    expect(() => new Script(bundle.javascript)).not.toThrow();
    expect(bundle.description).toContain(
      'Of its 4 widgets, 2 can be fed by the selected datasets, 1 in part and 1 not at all',
    );
  });

  it('draws the dashboard alone without a mapping', () => {
    const alone = renderDashboardBundle(blueprint, null);
    expect(alone.javascript).toContain('"mapping":null');
    expect(alone.description).not.toContain('Of its 4 widgets');
    expect(() => new Script(alone.javascript)).not.toThrow();
  });

  it('cannot be broken out of by a title', () => {
    const hostile = renderDashboardBundle(
      { ...blueprint, title: '</script><script>alert(1)</script>' },
      mapping,
    );
    expect(hostile.javascript).not.toContain('</script>');
    expect(() => new Script(hostile.javascript)).not.toThrow();
  });
});

describe('mappingExplanation', () => {
  const answer = mappingExplanation({
    blueprint,
    mapping,
    datasets: ['Shop'],
    entityCount: 1,
  });

  it('gives the result, the process and every widget with its sources', () => {
    expect(answer).toContain(
      'Recreated **Sales Performance 2025** with 4 widgets and 2 filters, and mapped it to **Shop**.',
    );
    expect(answer).toContain(
      '**Result:** 2 mapped, 1 partly mapped, 1 with no data.',
    );
    expect(answer).toContain('### How the mapping was done');
    expect(answer).toContain(
      '3. **Map data.** Everything rests on shop.orders, one row per order.',
    );
    // Six column readings; revenue ×3 and month have a source.
    expect(answer).toContain(
      '4 of 6 column readings ended with a source, from `shop.orders`.',
    );
    expect(answer).toContain(
      '| Monthly revenue | bar | Mapped | `revenue` → `shop.orders.total_amount`; `month` → `shop.orders.order_date` | Every column it reads has a source. |',
    );
    expect(answer).toContain(
      '| Revenue by region | table | Partly mapped | `revenue` → `shop.orders.total_amount`; `region` → none | Grouped by region. region: Proposed shop.orders.area is not in the catalog. |',
    );
  });

  it('lists the filters, the gaps and that the values are invented', () => {
    expect(answer).toContain(
      '| Region | Mapped | `region` → `shop.orders.Region` | — |',
    );
    expect(answer).toContain('### What the datasets lack');
    expect(answer).toContain('- Returns: add a returned flag.');
    expect(answer).toContain('no query was run');
  });
});

describe('the run result', () => {
  it('uses the default instructions when none are given', () => {
    expect(recreateDashboardQuestion('  ')).toBe(
      RECREATE_DASHBOARD_DEFAULT_QUESTION,
    );
    expect(recreateDashboardQuestion(' Dark theme ')).toBe('Dark theme');
  });

  it("is Render dashboard's output, with the counts", () => {
    expect(
      renderedDashboard({
        visualId: 'v-1',
        title: 'Sales',
        answer: 'Explained.',
        blueprint,
        mapping,
      }),
    ).toEqual({
      visualId: 'v-1',
      title: 'Sales',
      widgetCount: 4,
      filterCount: 2,
      mappedCount: 2,
      partialCount: 1,
      unmappedCount: 1,
      answer: 'Explained.',
      blueprint,
      mapping,
    });
  });
});

describe('the catalogue', () => {
  it('connects every step from Start to End in order', () => {
    const ids = RECREATE_DASHBOARD_STEPS.map((step) => step.id);
    expect(ids).toEqual([
      'load-source',
      'read-dashboard',
      'load-dashboard-catalog',
      'map-data',
      'render-dashboard',
    ]);
    // Read dashboard is a branch: a saved dashboard goes round it.
    expect(
      RECREATE_DASHBOARD_EDGES.map(
        (edge) => `${edge.from}>${edge.to}:${edge.kind}`,
      ),
    ).toEqual([
      'start>load-source:next',
      'load-source>read-dashboard:branch',
      'load-source>load-dashboard-catalog:branch',
      'read-dashboard>load-dashboard-catalog:next',
      'load-dashboard-catalog>map-data:next',
      'map-data>render-dashboard:next',
      'render-dashboard>end:next',
    ]);
  });

  it('has two agent steps, each one model call without tools', () => {
    expect(
      RECREATE_DASHBOARD_STEPS.filter((step) => step.kind === 'agent').map(
        (step) => [step.id, step.modelOnly],
      ),
    ).toEqual([
      ['read-dashboard', true],
      ['map-data', true],
    ]);
  });
});
