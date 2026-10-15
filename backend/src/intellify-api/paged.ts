import { applyDecorators, Type as ClassType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export const DEFAULT_PER_PAGE = 100;
export const MAX_PER_PAGE = 500;

export interface Paged<T> {
  data: T[];
  page: number;
  per_page: number;
  total: number;
}

/**
 * `page` / `per_page` of the collection routes (api.md 2.16). A value that is
 * not a positive integer is a 400; a `per_page` above the cap is lowered. The
 * OpenAPI side of both is declared by `ApiPagedResponse`, not here.
 */
export class PagedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'number' ? Math.min(value, MAX_PER_PAGE) : value,
  )
  per_page: number = DEFAULT_PER_PAGE;
}

/** SQL `LIMIT` / `OFFSET` for a validated page query. */
export function pageWindow(query: PagedQueryDto): {
  limit: number;
  offset: number;
} {
  const perPage = Math.min(query.per_page, MAX_PER_PAGE);
  return { limit: perPage, offset: (query.page - 1) * perPage };
}

export function paginate<T>(
  total: number,
  rows: T[],
  page: number,
  perPage: number,
): Paged<T> {
  return { data: rows, page, per_page: perPage, total };
}

/**
 * Declares a collection operation for REST discovery: optional `page` and
 * `per_page` query parameters and a `{ data: RowDto[], page, per_page, total }`
 * response, which discovery proposes as a table with rows pointer `/data`.
 */
export function ApiPagedResponse<T>(row: ClassType<T>) {
  return applyDecorators(
    ApiExtraModels(row),
    ApiQuery({
      name: 'page',
      required: false,
      schema: { type: 'integer', minimum: 1, default: 1 },
    }),
    ApiQuery({
      name: 'per_page',
      required: false,
      schema: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_PER_PAGE,
        default: DEFAULT_PER_PAGE,
      },
    }),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'page', 'per_page', 'total'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(row) } },
          page: { type: 'integer' },
          per_page: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
    }),
  );
}
