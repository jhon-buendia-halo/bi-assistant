import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PagedQueryDto } from '../../paged';
import { RFP_STATUSES, type RfpStatus } from '../rfp.types';

/** `GET /v1/rfps` (I12). */
export class ListRfpsQueryDto extends PagedQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientOneCode?: string;

  @ApiPropertyOptional({ enum: RFP_STATUSES })
  @IsOptional()
  @IsIn(RFP_STATUSES)
  status?: RfpStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;
}

/** `DELETE /v1/rfps` (I29): `createdBy` is required. */
export class DeleteRfpsQueryDto {
  @ApiProperty({ description: 'Whose drafts to delete' })
  @IsString()
  @IsNotEmpty()
  createdBy!: string;
}
