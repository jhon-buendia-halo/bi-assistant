/**
 * A small dashboard blueprint for the tests of the dashboard artifacts:
 * two KPI tiles, a bar chart and a table, with two filters. Test data
 * only; nothing at run time reads it.
 */
import type { DashboardBlueprint } from './dashboard-blueprint.schemas';

export const SAMPLE_BLUEPRINT: DashboardBlueprint = {
  title: 'Sales Performance 2025',
  summary: 'Tracks revenue and returns by month and region.',
  theme: { mode: 'light', accent: '#3b6cf6', palette: ['#3b6cf6'] },
  layout: 'Row 1: two KPI tiles. Row 2: a bar chart. Row 3: a table.',
  filters: [
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
  ],
  widgets: [
    {
      id: 'revenue',
      title: 'Revenue',
      kind: 'kpi',
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
      filteredBy: ['region'],
    },
    {
      id: 'revenue-2',
      title: 'Revenue',
      kind: 'other',
      span: 12,
      measures: [
        {
          label: 'return_rate',
          column: 'return_rate',
          aggregation: 'sum',
          format: 'percent',
          unit: '',
          total: null,
        },
      ],
      dimension: '',
      description: '',
      observed: '',
      filteredBy: [],
    },
    {
      id: 'monthly',
      title: 'Monthly revenue',
      kind: 'bar',
      span: 4,
      measures: [
        {
          label: 'Revenue',
          column: 'revenue',
          aggregation: 'sum',
          format: 'currency',
          unit: '',
          total: null,
        },
      ],
      dimension: 'month',
      description: '',
      observed: '',
      filteredBy: ['region'],
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
          unit: '',
          total: null,
        },
      ],
      dimension: 'region',
      description: '',
      observed: '',
      filteredBy: [],
    },
  ],
  columns: [
    {
      name: 'month',
      type: 'date',
      description: 'Order month',
      values: ['Jan', 'Feb', 'Mar'],
      min: null,
      max: null,
    },
    {
      name: 'region',
      type: 'string',
      description: 'Sales region',
      values: ['North America', 'Europe'],
      min: null,
      max: null,
    },
    {
      name: 'revenue',
      type: 'number',
      description: 'Revenue of the row',
      values: [],
      min: 1000,
      max: 6000,
    },
    {
      name: 'return_rate',
      type: 'number',
      description: '',
      values: [],
      min: 0.01,
      max: 0.06,
    },
    {
      name: 'channel',
      type: 'string',
      description: '',
      values: [],
      min: null,
      max: null,
    },
  ],
};
