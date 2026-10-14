import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_PLAN_YEAR,
  MAX_STAGE,
  MIN_PLAN_YEAR,
  MIN_STAGE,
  RFP_STATUSES,
  SECTION_KEYS,
  type RfpStatus,
} from '../rfp.types';
import { IsIsoDate, IsSectionsPatch } from './validators';

/** `PATCH /v1/rfps/:id` (I23). */
export class UpdateRfpDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ minimum: MIN_PLAN_YEAR, maximum: MAX_PLAN_YEAR })
  @IsOptional()
  @IsInt()
  @Min(MIN_PLAN_YEAR)
  @Max(MAX_PLAN_YEAR)
  planYear?: number;

  @ApiPropertyOptional({ format: 'date', example: '2027-01-01' })
  @IsOptional()
  @IsIsoDate()
  effectiveDate?: string;

  @ApiPropertyOptional({
    enum: RFP_STATUSES,
    description: 'Moves forward only: draft → ready → issued → closed',
  })
  @IsOptional()
  @IsIn(RFP_STATUSES)
  status?: RfpStatus;

  @ApiPropertyOptional({
    minimum: MIN_STAGE,
    maximum: MAX_STAGE,
    description: 'The last completed stage',
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_STAGE)
  @Max(MAX_STAGE)
  stage?: number;

  @ApiPropertyOptional({
    type: 'object',
    description: `Merged key by key; null removes a key. Keys: ${SECTION_KEYS.join(', ')}`,
    properties: Object.fromEntries(
      SECTION_KEYS.map((key) => [key, { type: 'string', nullable: true }]),
    ),
    additionalProperties: false,
  })
  @IsOptional()
  @IsSectionsPatch()
  sections?: Record<string, string | null>;
}
