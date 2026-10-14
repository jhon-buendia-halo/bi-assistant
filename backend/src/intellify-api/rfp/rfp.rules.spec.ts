import { BadRequestException, ConflictException } from '@nestjs/common';
import { toErrorBody } from '../http-error.filter';
import {
  assertDeletable,
  assertStatusMove,
  defaultEffectiveDate,
  defaultTitle,
  isIsoDate,
  isUuid,
  mergeSections,
  resolveCarriers,
  resolveLines,
  sectionPatchProblems,
} from './rfp.rules';
import { RFP_STATUSES } from './rfp.types';

const products = [
  { id: 'p-med', name: 'Medical' },
  { id: 'p-den', name: 'Dental' },
];
const planDesigns = [
  { id: 'pd-med-1', line: 'Medical' },
  { id: 'pd-den-1', line: 'Dental' },
];
const insurers = [
  { id: 'i-aet', name: 'Aetna' },
  { id: 'i-dd', name: 'Delta Dental' },
];

function errorOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return toErrorBody(error);
  }
  throw new Error('expected an error');
}

describe('rfp rules', () => {
  describe('status moves', () => {
    it('allows staying put and every forward move', () => {
      RFP_STATUSES.forEach((from, i) =>
        RFP_STATUSES.slice(i).forEach((to) =>
          expect(() => assertStatusMove(from, to)).not.toThrow(),
        ),
      );
    });

    it('refuses every backward move as a 409 conflict', () => {
      expect(() => assertStatusMove('issued', 'draft')).toThrow(
        ConflictException,
      );
      const body = errorOf(() => assertStatusMove('closed', 'ready'));
      expect(body).toMatchObject({ statusCode: 409, code: 'conflict' });
      expect(body.message).toContain('"closed" to "ready"');
    });

    it('deletes drafts only', () => {
      expect(() => assertDeletable('x', 'draft')).not.toThrow();
      for (const status of ['ready', 'issued', 'closed'] as const) {
        expect(errorOf(() => assertDeletable('x', status))).toMatchObject({
          statusCode: 409,
          code: 'conflict',
        });
      }
    });
  });

  it('defaults the title and effective date', () => {
    expect(defaultTitle('Orchard Manufacturing', 2027)).toBe(
      'Orchard Manufacturing — 2027 benefits RFP',
    );
    expect(defaultEffectiveDate(2027)).toBe('2027-01-01');
  });

  it('accepts only real ISO dates and UUIDs', () => {
    expect(isIsoDate('2027-01-01')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2027-1-1')).toBe(false);
    expect(isIsoDate('next week')).toBe(false);
    expect(isIsoDate(20270101)).toBe(false);
    expect(isUuid('11111111-2222-4333-8444-555555555555')).toBe(true);
    expect(isUuid('nope')).toBe(false);
  });

  describe('sections', () => {
    it('reports unknown keys and non-text values', () => {
      expect(
        sectionPatchProblems({ executiveSummary: 'x', notes: null }),
      ).toEqual([]);
      expect(sectionPatchProblems({ summary: 'x' })[0]).toContain(
        'unknown key "summary"',
      );
      expect(sectionPatchProblems({ notes: 3 })).toEqual([
        'sections.notes must be a string or null',
      ]);
      expect(sectionPatchProblems([])).toEqual(['sections must be an object']);
    });

    it('merges key by key; null or empty removes a key', () => {
      expect(
        mergeSections(
          { executiveSummary: 'old', notes: 'keep', scopeStatement: 'drop' },
          {
            executiveSummary: 'new',
            scopeStatement: null,
            evaluationCriteria: 'add',
          },
        ),
      ).toEqual({
        executiveSummary: 'new',
        evaluationCriteria: 'add',
        notes: 'keep',
      });
      expect(mergeSections({ notes: 'x' }, { notes: '' })).toEqual({});
    });
  });

  describe('lines', () => {
    it('resolves the product, canonical name and plan designs', () => {
      const rows = resolveLines(
        [
          { line: 'medical', marketBasis: 'as-is', planDesignIds: [] },
          {
            line: 'Dental',
            marketBasis: 'alternate',
            planDesignIds: ['pd-den-1', 'pd-den-1'],
            alternateFunding: 'Fully Insured',
            alternatePlanType: ' ',
            notes: null,
          },
        ],
        products,
        planDesigns,
        'IC1',
      );
      expect(rows).toEqual([
        {
          line: 'Medical',
          productId: 'p-med',
          planDesignIds: [],
          marketBasis: 'as-is',
        },
        {
          line: 'Dental',
          productId: 'p-den',
          planDesignIds: ['pd-den-1'],
          marketBasis: 'alternate',
          alternateFunding: 'Fully Insured',
        },
      ]);
    });

    it('lists unknown lines, foreign plan designs and duplicates', () => {
      const body = errorOf(() =>
        resolveLines(
          [
            { line: 'Pet insurance', marketBasis: 'as-is' },
            {
              line: 'Medical',
              marketBasis: 'as-is',
              planDesignIds: ['other-client'],
            },
            {
              line: 'Dental',
              marketBasis: 'as-is',
              planDesignIds: ['pd-med-1'],
            },
            { line: 'MEDICAL', marketBasis: 'as-is' },
          ],
          products,
          planDesigns,
          'IC1',
        ),
      );
      expect(body).toMatchObject({ statusCode: 400, code: 'validation' });
      expect(body.details).toEqual([
        'Item 1: unknown line "Pet insurance". Known: Medical, Dental',
        'Item 2: plan design "other-client" does not belong to client "IC1"',
        'Item 3: plan design "pd-med-1" is a Medical plan, not Dental',
        'Item 4: line "Medical" is listed twice',
      ]);
    });
  });

  describe('carriers', () => {
    it('accepts an insurer id or its exact name, case-insensitively', () => {
      const rows = resolveCarriers(
        [
          { insurer: 'i-aet', lines: ['medical'], incumbent: true },
          { insurer: 'delta dental', lines: ['Dental'], contactEmail: 'a@b.c' },
        ],
        insurers,
        products,
      );
      expect(rows).toEqual([
        {
          insurerId: 'i-aet',
          insurerName: 'Aetna',
          lines: ['Medical'],
          incumbent: true,
        },
        {
          insurerId: 'i-dd',
          insurerName: 'Delta Dental',
          lines: ['Dental'],
          incumbent: false,
          contactEmail: 'a@b.c',
        },
      ]);
    });

    it('names an unknown carrier and the known ones', () => {
      expect(() =>
        resolveCarriers([{ insurer: 'Acme', lines: [] }], insurers, products),
      ).toThrow(BadRequestException);
      const body = errorOf(() =>
        resolveCarriers([{ insurer: 'Acme', lines: [] }], insurers, products),
      );
      expect(body).toMatchObject({
        statusCode: 400,
        code: 'validation',
        message: 'Unknown carrier "Acme". Known: Aetna, Delta Dental',
      });
    });
  });
});
