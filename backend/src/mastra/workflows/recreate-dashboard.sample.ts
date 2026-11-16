/**
 * A small dashboard for the tests of Dashboard Image to Artifact: what Read
 * dashboard and Map data reply for it, and the catalog it is mapped to.
 * Test data only; nothing at run time reads it.
 */
import type {
  CatalogEntity,
  EntityColumns,
} from './answer-business-question.steps';

/** Read dashboard's reply: two KPI tiles, a bar chart and a table. */
export const SAMPLE_BLUEPRINT_REPLY = {
  title: 'Sales Performance 2025',
  summary: 'Tracks revenue and returns by month and region.',
  theme: { mode: 'light', accent: '#3B6CF6', palette: ['#3b6cf6', 'orange'] },
  layout: 'Row 1: two KPI tiles. Row 2: a bar chart. Row 3: a table.',
  columns: [
    {
      name: 'month',
      type: 'date',
      description: 'Order month',
      values: ['Jan', 'Feb', 'Mar'],
    },
    {
      name: 'region',
      type: 'string',
      description: 'Sales region',
      values: ['North America', 'Europe'],
    },
    {
      name: 'revenue',
      type: 'number',
      description: 'Revenue of the row',
      min: 1000,
      max: 6000,
    },
    { name: 'return_rate', type: 'ratio', min: 0.01, max: 0.06 },
    { name: '', type: 'string' },
  ],
  filters: [
    {
      id: 'Region',
      label: 'Region',
      kind: 'select',
      column: 'region',
      options: ['All regions', 'North America', 'Europe'],
    },
    { label: 'Channel', kind: 'dropdown', column: 'channel', options: [7] },
  ],
  widgets: [
    {
      id: 'revenue',
      title: 'Revenue',
      kind: 'KPI',
      span: 3,
      measures: [
        {
          label: 'Revenue',
          column: 'revenue',
          aggregation: 'sum',
          format: 'currency',
          unit: '$',
          total: 1070000,
        },
      ],
      dimension: '',
      description: 'Total revenue',
      observed: '$1.07M',
      filteredBy: ['Region', 'missing'],
    },
    {
      title: 'Revenue',
      kind: 'sparkles',
      span: 40,
      measures: [
        { column: 'return_rate', aggregation: 'median', format: 'percent' },
        { label: 'No column' },
      ],
    },
    {
      id: 'monthly',
      title: 'Monthly revenue',
      kind: 'bar',
      measures: [
        {
          label: 'Revenue',
          column: 'revenue',
          aggregation: 'sum',
          format: 'currency',
        },
      ],
      dimension: 'month',
      filteredBy: ['Region'],
    },
    {
      id: 'by-region',
      title: 'Revenue by region',
      kind: 'table',
      span: 12,
      measures: [
        {
          label: 'Revenue',
          column: 'revenue',
          aggregation: 'sum',
          format: 'currency',
        },
      ],
      dimension: 'region',
      filteredBy: [],
    },
  ],
};

/** The catalog of the run's one dataset: one entity, four columns. */
export const SAMPLE_CATALOG: CatalogEntity[] = [
  {
    entity: 'shop.orders',
    dataset: 'Shop',
    datasourceId: 'd-1',
    datasourceKind: 'postgres',
    columnCount: 4,
  },
];

export const SAMPLE_COLUMNS: EntityColumns[] = [
  {
    entity: 'shop.orders',
    columns: [
      { name: 'order_date', type: 'date' },
      { name: 'Region', type: 'text' },
      { name: 'total_amount', type: 'numeric' },
      { name: 'order_id', type: 'int' },
    ],
    more: 0,
  },
];

const source = (field: string, column: string, note = '') => ({
  field,
  entity: column ? 'shop.orders' : '',
  column,
  note,
});

/**
 * Map data's reply: revenue, month and region have a source, the return
 * rate has none, and the channel filter names a column the catalog lacks.
 */
export const SAMPLE_MAPPING_REPLY = {
  approach: 'Everything rests on shop.orders, one row per order.',
  widgets: [
    {
      widgetId: 'revenue',
      status: 'unmapped',
      fields: [source('revenue', 'total_amount', 'Sum of the amount.')],
      reason: 'Sum of total_amount over shop.orders.',
    },
    {
      widgetId: 'revenue-2',
      fields: [source('return_rate', '', 'No column records returns.')],
      reason: 'The datasets hold no returns.',
    },
    {
      widgetId: 'monthly',
      fields: [
        source('revenue', 'TOTAL_AMOUNT'),
        source('month', 'order_date', 'Truncated to the month.'),
      ],
    },
    {
      widgetId: 'by-region',
      fields: [source('revenue', 'total_amount'), source('region', 'area')],
      reason: 'Grouped by region.',
    },
    { widgetId: 'not-a-widget', fields: [source('x', 'order_id')] },
  ],
  filters: [
    { filterId: 'region', field: source('region', 'region') },
    { filterId: 'channel', field: source('channel', 'sales_channel') },
  ],
  gaps: ['Returns: add a returned flag.', ''],
};
