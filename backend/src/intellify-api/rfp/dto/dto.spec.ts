import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { toErrorBody } from '../../http-error.filter';
import { ListBodyPipe } from '../list-body.pipe';
import { CreateRfpDto } from './create-rfp.dto';
import {
  LineInputDto,
  MilestoneInputDto,
  RequirementInputDto,
} from './list-items.dto';
import { UpdateRfpDto } from './update-rfp.dto';

async function problems<T extends object>(cls: new () => T, value: object) {
  const errors = await validate(plainToInstance(cls, value), {
    whitelist: true,
  });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('RFP DTOs', () => {
  it('checks the plan year on create', async () => {
    expect(
      await problems(CreateRfpDto, { clientOneCode: 'IC1', planYear: 2027 }),
    ).toEqual([]);
    expect(
      await problems(CreateRfpDto, { clientOneCode: 'IC1', planYear: 2036 }),
    ).toHaveLength(1);
    expect(
      await problems(CreateRfpDto, { clientOneCode: 'IC1', planYear: 2027.5 }),
    ).toHaveLength(1);
  });

  it('checks stage, status, dates and section keys on patch', async () => {
    expect(
      await problems(UpdateRfpDto, {
        stage: 7,
        status: 'ready',
        effectiveDate: '2027-01-01',
        sections: { notes: 'x' },
      }),
    ).toEqual([]);
    expect(await problems(UpdateRfpDto, { stage: 8 })).toHaveLength(1);
    expect(await problems(UpdateRfpDto, { stage: -1 })).toHaveLength(1);
    expect(await problems(UpdateRfpDto, { status: 'archived' })).toHaveLength(
      1,
    );
    expect(
      await problems(UpdateRfpDto, { effectiveDate: '2027-13-01' }),
    ).toEqual([
      'effectiveDate must be a date as YYYY-MM-DD (got "2027-13-01")',
    ]);
    const unknown = await problems(UpdateRfpDto, {
      sections: { summary: 'x' },
    });
    expect(unknown[0]).toContain('unknown key "summary"');
  });

  describe('ListBodyPipe', () => {
    it('validates each item and returns instances', async () => {
      const pipe = new ListBodyPipe(MilestoneInputDto);
      const items = await pipe.transform([
        { milestone: 'Issue', dueDate: '2026-11-02', extra: 'stripped' },
      ]);
      expect(items[0]).toBeInstanceOf(MilestoneInputDto);
      expect(items[0]).toEqual({ milestone: 'Issue', dueDate: '2026-11-02' });
    });

    it('answers 400 validation with one detail per problem', async () => {
      const pipe = new ListBodyPipe(RequirementInputDto);
      const error = await pipe
        .transform([
          { section: 'A', question: 'Q', answerType: 'essay' },
          'not an object',
        ])
        .catch((e: unknown) => e);
      expect(toErrorBody(error)).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        code: 'validation',
        details: [
          'Item 1: answerType must be one of the following values: text, yes_no, number, table, attachment',
          'Item 2: must be an object',
        ],
      });
    });

    it('refuses a body that is not an array', async () => {
      const error = await new ListBodyPipe(LineInputDto)
        .transform({ line: 'Medical' })
        .catch((e: unknown) => e);
      expect(toErrorBody(error)).toMatchObject({
        statusCode: 400,
        code: 'validation',
        details: ['the body must be a JSON array'],
      });
    });
  });
});
