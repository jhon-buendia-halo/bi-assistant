import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { pageWindow, paginate, PagedQueryDto } from './paged';

const parse = (query: object) => {
  const dto = plainToInstance(PagedQueryDto, query);
  return { dto, errors: validateSync(dto) };
};

describe('paged', () => {
  it('paginate wraps rows with page, per_page and total', () => {
    expect(paginate(7, ['a', 'b'], 2, 2)).toEqual({
      data: ['a', 'b'],
      page: 2,
      per_page: 2,
      total: 7,
    });
  });

  it('defaults to page 1 of 100', () => {
    const { dto, errors } = parse({});
    expect(errors).toHaveLength(0);
    expect(pageWindow(dto)).toEqual({ limit: 100, offset: 0 });
  });

  it('caps per_page at 500 instead of rejecting it', () => {
    const { dto, errors } = parse({ page: '3', per_page: '9000' });
    expect(errors).toHaveLength(0);
    expect(dto.per_page).toBe(500);
    expect(pageWindow(dto)).toEqual({ limit: 500, offset: 1000 });
  });

  it.each([
    { page: '0' },
    { page: 'x' },
    { per_page: '-1' },
    { per_page: '1.5' },
  ])('rejects %j', (query) => {
    expect(parse(query).errors.length).toBeGreaterThan(0);
  });
});
