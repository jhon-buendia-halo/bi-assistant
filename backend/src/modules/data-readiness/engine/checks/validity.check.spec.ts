import { validityCheck } from './validity.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type { CheckContext } from '../types';
import type { EntityProfile, FieldProfile } from '../types';

const CTX: CheckContext = {
  thresholds: DEFAULT_THRESHOLDS,
  now: new Date('2026-01-01T00:00:00Z'),
};

function entity(fields: FieldProfile[]): EntityProfile {
  return {
    namespace: 'public',
    name: 'customers',
    rowCount: 100,
    fields,
    keys: [],
  };
}

describe('validityCheck', () => {
  it('flags a formatted column with violations', () => {
    const { findings } = validityCheck(
      entity([
        {
          name: 'email',
          type: 'text',
          semanticType: 'text',
          nullable: true,
          formatRule: 'email',
          invalidFormatCount: 7,
        },
      ]),
      CTX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('validity');
    expect(findings[0].field).toBe('email');
  });

  it('ignores formatted columns with zero violations', () => {
    const { findings } = validityCheck(
      entity([
        {
          name: 'email',
          type: 'text',
          semanticType: 'text',
          nullable: true,
          formatRule: 'email',
          invalidFormatCount: 0,
        },
      ]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores columns with no detected format rule', () => {
    const { findings } = validityCheck(
      entity([
        { name: 'note', type: 'text', semanticType: 'text', nullable: true },
      ]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('counts one check per format-ruled field (denominator)', () => {
    const e = entity([
      {
        name: 'email',
        type: 'text',
        semanticType: 'text',
        nullable: true,
        formatRule: 'email',
        invalidFormatCount: 0,
      },
      {
        name: 'phone',
        type: 'text',
        semanticType: 'text',
        nullable: true,
        formatRule: 'phone',
        invalidFormatCount: 0,
      },
      { name: 'note', type: 'text', semanticType: 'text', nullable: true }, // no rule → not checked
    ]);
    expect(validityCheck(e, CTX).checksRun).toBe(2);
  });
});
