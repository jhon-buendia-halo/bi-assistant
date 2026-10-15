import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PLAN_YEAR, MIN_PLAN_YEAR } from '../rfp.types';

/** `POST /v1/rfps` (I21). */
export class CreateRfpDto {
  @ApiProperty({ description: "The client's one_code, e.g. IC100100" })
  @IsString()
  @IsNotEmpty()
  clientOneCode!: string;

  @ApiProperty({ minimum: MIN_PLAN_YEAR, maximum: MAX_PLAN_YEAR })
  @IsInt()
  @Min(MIN_PLAN_YEAR)
  @Max(MAX_PLAN_YEAR)
  planYear!: number;

  @ApiPropertyOptional({
    description: 'Defaults to "<client name> — <planYear> benefits RFP"',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({
    description: 'Who creates it; else the X-Qti-User header',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  createdBy?: string;
}
