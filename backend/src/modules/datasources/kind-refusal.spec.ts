import { unsupportedKindMessage } from './kind-refusal';

describe('unsupportedKindMessage', () => {
  it('names an Excel / CSV datasource', () => {
    expect(unsupportedKindMessage('Data Readiness', 'Sales', 'file')).toBe(
      'Data Readiness supports PostgreSQL and Databricks datasources; "Sales" is an Excel / CSV datasource.',
    );
  });
  it('names a REST API datasource', () => {
    expect(unsupportedKindMessage('Synthetic data', 'Api', 'rest')).toBe(
      'Synthetic data supports PostgreSQL and Databricks datasources; "Api" is a REST API datasource.',
    );
  });
});
