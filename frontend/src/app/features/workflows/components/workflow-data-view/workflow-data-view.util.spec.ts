import { jsonTokens, schemaOf, tableOf } from './workflow-data-view.util';

describe('workflow data view util', () => {
  describe('tableOf', () => {
    it('reads an array of objects, columns in first-seen order', () => {
      expect(tableOf([{ a: 1 }, { a: 2, b: 3 }])).toEqual({
        columns: ['a', 'b'],
        rows: [{ a: 1 }, { a: 2, b: 3 }],
      });
    });

    it('reads the array an object holds', () => {
      const table = tableOf({
        total: 2,
        rows: [{ state: 'CA' }, { state: 'TX' }],
      });
      expect(table?.columns).toEqual(['state']);
      expect(table?.rows.length).toBe(2);
    });

    it('is null for scalars, empty arrays and arrays of scalars', () => {
      expect(tableOf('x')).toBeNull();
      expect(tableOf([])).toBeNull();
      expect(tableOf([1, 2])).toBeNull();
      expect(tableOf({ a: 1 })).toBeNull();
      expect(tableOf(null)).toBeNull();
    });
  });

  describe('schemaOf', () => {
    it('infers key types and nests objects', () => {
      expect(schemaOf({ q: 'x', n: 1, ok: true, o: { z: null } })).toEqual([
        { name: 'q', type: 'string', children: [] },
        { name: 'n', type: 'number', children: [] },
        { name: 'ok', type: 'boolean', children: [] },
        {
          name: 'o',
          type: 'object',
          children: [{ name: 'z', type: 'null', children: [] }],
        },
      ]);
    });

    it('types arrays by their items and nests their keys', () => {
      const [calls, names] = schemaOf({
        calls: [{ id: 1 }, { id: 2, extra: 'x' }],
        names: ['a'],
      });
      expect(calls.type).toBe('object[]');
      expect(calls.children.map((c) => c.name)).toEqual(['id', 'extra']);
      expect(names.type).toBe('string[]');
    });

    it('describes an array root by its item keys and a scalar as one value', () => {
      expect(schemaOf([{ a: 1 }]).map((n) => n.name)).toEqual(['a']);
      expect(schemaOf(5)).toEqual([
        { name: 'value', type: 'number', children: [] },
      ]);
    });
  });

  describe('jsonTokens', () => {
    it('colours keys, strings, numbers and literals, and keeps the text intact', () => {
      const value = { a: 'x', b: 1.5, c: true, d: null };
      const tokens = jsonTokens(value);
      expect(tokens.map((t) => t.text).join('')).toBe(
        JSON.stringify(value, null, 2),
      );
      const kinds = (kind: string) =>
        tokens.filter((t) => t.kind === kind).map((t) => t.text);
      expect(kinds('key')).toEqual(['"a"', '"b"', '"c"', '"d"']);
      expect(kinds('string')).toEqual(['"x"']);
      expect(kinds('number')).toEqual(['1.5']);
      expect(kinds('literal')).toEqual(['true', 'null']);
    });
  });
});
