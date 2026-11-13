import { JsonSchema } from '../models/workflow.model';
import {
  contractFields,
  contractViolationSides,
  flattenContractFields,
  parseContractViolation,
  passesOnText,
  schemaTypeLabel,
} from './workflow-contract';

const ANALYSE_INPUT: JsonSchema = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'What the user asked.' },
    catalog: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity: { type: 'string' },
          rows: { type: 'integer' },
        },
        required: ['entity'],
      },
    },
    datasets: { type: 'array', items: { type: 'string' } },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['question', 'catalog'],
};

describe('workflow contract helpers (ui.md 4.4b)', () => {
  describe('schemaTypeLabel', () => {
    it('names scalar, array, object and union types', () => {
      expect(schemaTypeLabel({ type: 'string' })).toBe('string');
      expect(schemaTypeLabel({ type: 'integer' })).toBe('number');
      expect(schemaTypeLabel({ type: 'number' })).toBe('number');
      expect(schemaTypeLabel({ type: 'boolean' })).toBe('boolean');
      expect(schemaTypeLabel({ type: 'object' })).toBe('object');
      expect(
        schemaTypeLabel({ type: 'array', items: { type: 'string' } }),
      ).toBe('string[]');
      expect(
        schemaTypeLabel({ type: 'array', items: { type: 'object' } }),
      ).toBe('object[]');
      expect(schemaTypeLabel({ type: 'array' })).toBe('unknown[]');
      expect(schemaTypeLabel({ type: ['string', 'null'] })).toBe(
        'string | null',
      );
      expect(
        schemaTypeLabel({ anyOf: [{ type: 'number' }, { type: 'null' }] }),
      ).toBe('number | null');
      expect(schemaTypeLabel({ enum: ['a', 'b'] })).toBe('string');
      expect(schemaTypeLabel({ properties: { a: {} } })).toBe('object');
      expect(schemaTypeLabel({})).toBe('unknown');
    });
  });

  describe('contractFields', () => {
    it('lists the top-level properties in schema order with type, required and description', () => {
      const fields = contractFields(ANALYSE_INPUT);
      expect(
        fields.map(({ name, type, required, description }) => ({
          name,
          type,
          required,
          description,
        })),
      ).toEqual([
        {
          name: 'question',
          type: 'string',
          required: true,
          description: 'What the user asked.',
        },
        { name: 'catalog', type: 'object[]', required: true, description: null },
        { name: 'datasets', type: 'string[]', required: false, description: null },
        { name: 'note', type: 'string | null', required: false, description: null },
      ]);
    });

    it("nests an object array's item properties as children", () => {
      const catalog = contractFields(ANALYSE_INPUT)[1];
      expect(catalog.children.map((c) => [c.name, c.type, c.required])).toEqual(
        [
          ['entity', 'string', true],
          ['rows', 'number', false],
        ],
      );
      expect(
        flattenContractFields(contractFields(ANALYSE_INPUT)).map(
          (r) => `${r.depth}:${r.name}`,
        ),
      ).toEqual(['0:question', '0:catalog', '1:entity', '1:rows', '0:datasets', '0:note']);
    });

    it('falls back to the names without types when no schema is declared', () => {
      expect(contractFields(undefined, ['calls', 'stopped'])).toEqual([
        { name: 'calls', type: null, required: false, description: null, children: [] },
        { name: 'stopped', type: null, required: false, description: null, children: [] },
      ]);
      expect(contractFields({ type: 'object' }, ['a']).map((f) => f.name)).toEqual(
        ['a'],
      );
      expect(contractFields(null)).toEqual([]);
    });
  });

  describe('passesOnText', () => {
    it('names each field with its type, or just its name when untyped', () => {
      expect(passesOnText(contractFields(ANALYSE_INPUT).slice(0, 3))).toBe(
        'Passes on: question (string), catalog (object[]), datasets (string[])',
      );
      expect(passesOnText(contractFields(undefined, ['calls', 'stopped']))).toBe(
        'Passes on: calls, stopped',
      );
    });
  });

  describe('parseContractViolation', () => {
    it('reads an input violation: title, side, path and message', () => {
      expect(
        parseContractViolation(
          'Contract violation in Analyse (input): question Required',
        ),
      ).toEqual({
        stepTitle: 'Analyse',
        side: 'input',
        prefix: 'Contract violation in Analyse (input): ',
        path: 'question',
        message: 'Required',
      });
    });

    it('reads an output violation with a dotted path', () => {
      expect(
        parseContractViolation(
          'Contract violation in Wrap up: calls[2].rowCount Expected number, received string',
        ),
      ).toEqual({
        stepTitle: 'Wrap up',
        side: 'output',
        prefix: 'Contract violation in Wrap up: ',
        path: 'calls[2].rowCount',
        message: 'Expected number, received string',
      });
    });

    it('is null for any other error', () => {
      expect(parseContractViolation('Model error: 529')).toBeNull();
      expect(parseContractViolation(undefined)).toBeNull();
      expect(parseContractViolation('Contract violation')).toBeNull();
    });
  });

  describe('contractViolationSides', () => {
    it('maps each failed step with a contract violation to its side', () => {
      expect(
        contractViolationSides([
          { id: 'receive', status: 'success' },
          {
            id: 'analyse',
            status: 'failed',
            error: 'Contract violation in Analyse (input): question Required',
          },
          {
            id: 'wrap-up',
            status: 'failed',
            error: 'Contract violation in Wrap up: rows Expected array, received string',
          },
          { id: 'other', status: 'failed', error: 'Boom' },
          {
            id: 'ok',
            status: 'success',
            error: 'Contract violation in Ok: x Required',
          },
        ]),
      ).toEqual({ analyse: 'input', 'wrap-up': 'output' });
      expect(contractViolationSides(undefined)).toEqual({});
    });
  });
});
