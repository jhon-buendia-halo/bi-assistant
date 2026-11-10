import { normalizeDatabricksHost } from './databricks-host';

describe('normalizeDatabricksHost (BA-322)', () => {
  it.each([
    ['https://dbc-1.cloud.databricks.com/', 'dbc-1.cloud.databricks.com'],
    ['HTTP://dbc-1.cloud.databricks.com//', 'dbc-1.cloud.databricks.com'],
    ['  dbc-1.cloud.databricks.com  ', 'dbc-1.cloud.databricks.com'],
    ['dbc-1.cloud.databricks.com', 'dbc-1.cloud.databricks.com'],
    [undefined, ''],
  ])('%p -> %p', (input, expected) => {
    expect(normalizeDatabricksHost(input)).toBe(expected);
  });
});
