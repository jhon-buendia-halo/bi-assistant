import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  ANSWER_TYPES,
  MARKET_BASES,
  type AnswerType,
  type MarketBasis,
} from '../rfp.types';
import { IsIsoDate } from './validators';

/** One item of `PUT /v1/rfps/:id/lines` (I24). */
export class LineInputDto {
  @ApiProperty({ description: 'Line of coverage (product name), e.g. Medical' })
  @IsString()
  @IsNotEmpty()
  line!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Plan designs in scope; empty = every plan of the line',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  planDesignIds?: string[];

  @ApiProperty({ enum: MARKET_BASES })
  @IsIn(MARKET_BASES)
  marketBasis!: MarketBasis;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alternateFunding?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alternatePlanType?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

/** One item of `PUT /v1/rfps/:id/carriers` (I25). */
export class CarrierInputDto {
  @ApiProperty({
    description: 'Insurer id or exact name (case-insensitive)',
  })
  @IsString()
  @IsNotEmpty()
  insurer!: string;

  @ApiProperty({ type: [String], description: 'Lines it is invited for' })
  @IsArray()
  @IsString({ each: true })
  lines!: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  incumbent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  contactEmail?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}

/** One item of `PUT /v1/rfps/:id/requirements` (I26). */
export class RequirementInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  section!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  question!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ enum: ANSWER_TYPES, default: 'text' })
  @IsOptional()
  @IsIn(ANSWER_TYPES)
  answerType?: AnswerType;
}

/** One item of `PUT /v1/rfps/:id/timeline` (I27). */
export class MilestoneInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  milestone!: string;

  @ApiProperty({ format: 'date', example: '2026-11-15' })
  @IsIsoDate()
  dueDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  owner?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;
}
