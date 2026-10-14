import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PagedQueryDto } from '../paged';

// Reusable property decorators; the swagger CLI plugin is off, so every field
// is declared explicitly for /openapi.json and REST discovery.
const Str: PropertyDecorator = ApiProperty({ type: String });
const NStr: PropertyDecorator = ApiProperty({ type: String, nullable: true });
const Int: PropertyDecorator = ApiProperty({ type: Number });
const NNum: PropertyDecorator = ApiProperty({ type: Number, nullable: true });

// --- query DTOs ---------------------------------------------------------------

/** `includeDeleted=true` brings back rows flagged `deleted` (api.md 2.16). */
export class IncludeDeletedQuery {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Include soft-deleted rows',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  includeDeleted?: boolean;
}

export class ProductsQuery extends PagedQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Include soft-deleted rows',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  includeDeleted?: boolean;
}

export class ClientsQuery extends ProductsQuery {
  @ApiPropertyOptional({
    description: 'Client name or oneCode, case-insensitive substring',
  })
  @IsOptional()
  @IsString()
  q?: string;
}

export class FundingTypesQuery extends PagedQueryDto {}

export class PlanTypesQuery extends PagedQueryDto {
  @ApiPropertyOptional({ description: 'Line of coverage (product name)' })
  @IsOptional()
  @IsString()
  line?: string;
}

export class CarriersQuery extends ProductsQuery {
  @ApiPropertyOptional({
    description:
      'Line of coverage (product name): only carriers with plans in it',
  })
  @IsOptional()
  @IsString()
  line?: string;

  @ApiPropertyOptional({
    description:
      'Client oneCode: fills incumbentFor and finalCredits for that client',
  })
  @IsOptional()
  @IsString()
  clientOneCode?: string;
}

export class PlanDesignsQuery extends ProductsQuery {
  @ApiPropertyOptional({ description: 'Client oneCode' })
  @IsOptional()
  @IsString()
  clientOneCode?: string;

  @ApiPropertyOptional({ description: 'Line of coverage (product name)' })
  @IsOptional()
  @IsString()
  line?: string;
}

export class PoliciesQuery extends ProductsQuery {
  @ApiPropertyOptional({ description: 'Client oneCode' })
  @IsOptional()
  @IsString()
  clientOneCode?: string;
}

export class FinancialsQuery extends PlanDesignsQuery {
  @ApiPropertyOptional({ type: Number, description: 'Plan year, e.g. 2026' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  planYear?: number;
}

export class CensusQuery extends ProductsQuery {
  @ApiPropertyOptional({ description: 'Client oneCode' })
  @IsOptional()
  @IsString()
  clientOneCode?: string;

  @ApiPropertyOptional({ description: 'Effective year, e.g. 2026' })
  @IsOptional()
  @IsString()
  year?: string;
}

/** Per-client routes. */
export class ClientReadQuery extends IncludeDeletedQuery {}

export class ProgramQuery extends IncludeDeletedQuery {
  @ApiPropertyOptional({ description: 'Line of coverage (product name)' })
  @IsOptional()
  @IsString()
  line?: string;
}

export class ClientFinancialsQuery extends ProgramQuery {
  @ApiPropertyOptional({
    type: Number,
    description: 'Plan year; default the latest',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  planYear?: number;
}

export class ClientCensusQuery extends IncludeDeletedQuery {
  @ApiPropertyOptional({ description: 'Effective year; default the latest' })
  @IsOptional()
  @IsString()
  year?: string;
}

// --- row DTOs (collections) ---------------------------------------------------

export class ClientRowDto {
  @Str id!: string;
  @Str oneCode!: string;
  @Str name!: string;
  @NStr tenantKey!: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Latest census totalEmployees',
  })
  headcount!: number | null;
  @NStr latestCensusYear!: string | null;
  @Int linesOffered!: number;
  @NStr nextRenewalEffectiveDate!: string | null;
}

export class ProductRowDto {
  @Str id!: string;
  @Str name!: string;
  @Str locType!: string;
  @Int displayOrder!: number;
}

export class FundingTypeRowDto {
  @Str id!: string;
  @Str name!: string;
  @Int displayOrder!: number;
  @NStr theme!: string | null;
}

export class PlanTypeRowDto {
  @Str id!: string;
  @Str line!: string;
  @Str name!: string;
}

export class CarrierRowDto {
  @Str id!: string;
  @Str name!: string;
  @Str code!: string;
  @ApiProperty({
    type: [String],
    description: 'Lines where the carrier has plan designs',
  })
  lines!: string[];
  @ApiProperty({
    type: [String],
    description:
      'Lines where it carries a live policy for clientOneCode; [] without it',
  })
  incumbentFor!: string[];
  @ApiProperty({
    type: Number,
    description:
      'Final, unexpired carrier credits for clientOneCode; 0 without it',
  })
  finalCredits!: number;
}

export class PlanDesignRowDto {
  @Str id!: string;
  @Str clientOneCode!: string;
  @Str clientName!: string;
  @Str line!: string;
  @NStr planType!: string | null;
  @NStr carrier!: string | null;
  @NStr fundingType!: string | null;
  @NStr state!: string | null;
  @NStr creationFlag!: string | null;
  @NStr policyNumber!: string | null;
  @NNum enrolledEmployees!: number | null;
  @NNum annualPremium!: number | null;
  @NNum planYear!: number | null;
}

export class PolicyRowDto {
  @Str id!: string;
  @Str clientOneCode!: string;
  @NStr carrier!: string | null;
  @NStr number!: string | null;
  @NStr kickOffTiming!: string | null;
  @NNum kickOffDays!: number | null;
  @Int coverages!: number;
}

export class FinancialRowDto {
  @Str coverageId!: string;
  @Str clientOneCode!: string;
  @Str line!: string;
  @NStr planDesignId!: string | null;
  @NStr carrier!: string | null;
  @NStr fundingType!: string | null;
  @NStr planType!: string | null;
  @NStr ratingBasis!: string | null;
  @NNum planYear!: number | null;
  @NNum enrolledEmployees!: number | null;
  @NNum coveredLives!: number | null;
  @NNum monthlyPremium!: number | null;
  @NNum annualPremium!: number | null;
  @NNum priorYearAnnualPremium!: number | null;
  @NNum renewalIncreasePct!: number | null;
  @NNum employerPct!: number | null;
  @NNum employeeMonthlyEmployeeOnly!: number | null;
  @NNum adminFeePepm!: number | null;
  @NNum stopLossPepm!: number | null;
  @NNum ratePer1000!: number | null;
  @NNum pepm!: number | null;
  @NNum rateEmployeeOnly!: number | null;
  @NNum rateEmployeeSpouse!: number | null;
  @NNum rateEmployeeChildren!: number | null;
  @NNum rateFamily!: number | null;
  @NNum enrollEmployeeOnly!: number | null;
  @NNum enrollEmployeeSpouse!: number | null;
  @NNum enrollEmployeeChildren!: number | null;
  @NNum enrollFamily!: number | null;
}

export class CensusRowDto {
  @Str documentId!: string;
  @Str clientOneCode!: string;
  @Str effectiveYear!: string;
  @NNum totalEmployees!: number | null;
  @NNum eligibleEmployees!: number | null;
  @NNum enrolledEmployees!: number | null;
  @NNum averageAge!: number | null;
  @NNum averageSalary!: number | null;
  @NNum femalePct!: number | null;
  @NNum malePct!: number | null;
  @NNum fullTime!: number | null;
  @NNum partTime!: number | null;
  @NNum tierEmployeeOnly!: number | null;
  @NNum tierEmployeeSpouse!: number | null;
  @NNum tierEmployeeChildren!: number | null;
  @NNum tierFamily!: number | null;
  @Int statesCount!: number;
  @NNum participationRate!: number | null;
  @NStr source!: string | null;
  @NStr uploadedAt!: string | null;
}
