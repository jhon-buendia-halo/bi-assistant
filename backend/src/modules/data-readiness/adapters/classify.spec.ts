import { classifyDatabricksType, classifyType } from './classify';

describe('classifyType (Postgres)', () => {
  it.each([
    ['integer', 'numeric'],
    ['bigint', 'numeric'],
    ['smallint', 'numeric'],
    ['numeric(10,2)', 'numeric'],
    ['real', 'numeric'],
    ['double precision', 'numeric'],
    ['money', 'numeric'],
    ['date', 'temporal'],
    ['time without time zone', 'temporal'],
    ['timestamp with time zone', 'temporal'],
    ['interval', 'temporal'],
    ['text', 'text'],
    ['character varying(255)', 'text'],
    ['character(3)', 'text'],
    ['Boolean', 'boolean'],
    ['uuid', 'uuid'],
    ['jsonb', 'json'],
    ['json', 'json'],
    ['text[]', 'other'],
    ['bytea', 'other'],
  ])('%s → %s', (type, expected) => {
    expect(classifyType(type)).toBe(expected);
  });
});

describe('classifyDatabricksType', () => {
  it.each([
    ['string', 'text'],
    ['string collate utf8_lcase', 'text'],
    ['varchar(20)', 'text'],
    ['char(2)', 'text'],
    ['int', 'numeric'],
    ['BIGINT', 'numeric'],
    ['tinyint', 'numeric'],
    ['double', 'numeric'],
    ['float', 'numeric'],
    ['decimal(18,2)', 'numeric'],
    ['date', 'temporal'],
    ['timestamp', 'temporal'],
    ['timestamp_ntz', 'temporal'],
    ['interval day to second', 'temporal'],
    ['boolean', 'boolean'],
    ['map<string,int>', 'json'],
    ['struct<a:int>', 'json'],
    ['array<string>', 'other'],
    ['binary', 'other'],
  ])('%s → %s', (type, expected) => {
    expect(classifyDatabricksType(type)).toBe(expected);
  });
});
