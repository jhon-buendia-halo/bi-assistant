import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ANSWER_TYPES,
  MARKET_BASES,
  RFP_STATUSES,
  type AnswerType,
  type MarketBasis,
  type RfpStatus,
} from '../rfp.types';

/** OpenAPI side of the RFP shapes (api.md 2.16.4); `rfp.types.ts` is the code side. */

class RfpHeaderDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() clientOneCode!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty() title!: string;
  @ApiProperty() planYear!: number;
  @ApiProperty({ format: 'date' }) effectiveDate!: string;
  @ApiProperty({ enum: RFP_STATUSES }) status!: RfpStatus;
  @ApiProperty({ minimum: 0, maximum: 7, description: 'Last completed stage' })
  stage!: number;
  @ApiProperty({ type: String, nullable: true }) createdBy!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiPropertyOptional({
    enum: [true],
    description: 'Present when the client is no longer in intellify.clients',
  })
  clientMissing?: true;
}

export class RfpSummaryDto extends RfpHeaderDto {
  @ApiProperty() lines!: number;
  @ApiProperty() carriers!: number;
  @ApiProperty() requirements!: number;
  @ApiProperty() milestones!: number;
}

export class RfpSectionsDto {
  @ApiPropertyOptional() executiveSummary?: string;
  @ApiPropertyOptional() clientBackground?: string;
  @ApiPropertyOptional() scopeStatement?: string;
  @ApiPropertyOptional() instructionsToBidders?: string;
  @ApiPropertyOptional() evaluationCriteria?: string;
  @ApiPropertyOptional() notes?: string;
}

export class RfpLineDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() line!: string;
  @ApiProperty() productId!: string;
  @ApiProperty({ type: [String] }) planDesignIds!: string[];
  @ApiProperty({ enum: MARKET_BASES }) marketBasis!: MarketBasis;
  @ApiPropertyOptional() alternateFunding?: string;
  @ApiPropertyOptional() alternatePlanType?: string;
  @ApiPropertyOptional() notes?: string;
}

export class RfpCarrierDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() insurerId!: string;
  @ApiProperty() insurerName!: string;
  @ApiProperty({ type: [String] }) lines!: string[];
  @ApiProperty() incumbent!: boolean;
  @ApiPropertyOptional() contactEmail?: string;
  @ApiPropertyOptional() notes?: string;
}

export class RfpRequirementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() section!: string;
  @ApiProperty() question!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty({ enum: ANSWER_TYPES }) answerType!: AnswerType;
}

export class RfpMilestoneDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() milestone!: string;
  @ApiProperty({ format: 'date' }) dueDate!: string;
  @ApiPropertyOptional() owner?: string;
  @ApiPropertyOptional() notes?: string;
}

export class RfpDto extends RfpHeaderDto {
  @ApiProperty({ type: RfpSectionsDto }) sections!: RfpSectionsDto;
  @ApiProperty({ type: [RfpLineDto] }) lines!: RfpLineDto[];
  @ApiProperty({ type: [RfpCarrierDto] }) carriers!: RfpCarrierDto[];
  @ApiProperty({ type: [RfpRequirementDto] })
  requirements!: RfpRequirementDto[];
  @ApiProperty({ type: [RfpMilestoneDto] }) timeline!: RfpMilestoneDto[];
}

export class DeletedCountDto {
  @ApiProperty() deleted!: number;
}
