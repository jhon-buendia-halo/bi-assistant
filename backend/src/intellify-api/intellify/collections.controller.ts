import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPagedResponse } from '../paged';
import {
  CarriersQuery,
  CarrierRowDto,
  CensusQuery,
  CensusRowDto,
  ClientRowDto,
  ClientsQuery,
  FinancialRowDto,
  FinancialsQuery,
  FundingTypeRowDto,
  FundingTypesQuery,
  PlanDesignRowDto,
  PlanDesignsQuery,
  PlanTypeRowDto,
  PlanTypesQuery,
  PoliciesQuery,
  PolicyRowDto,
  ProductRowDto,
  ProductsQuery,
} from './intellify.dto';
import { IntellifyReadService } from './intellify-read.service';

/** The paged collection routes (api.md 2.16.2, I3-I11). */
@ApiTags('intellify')
@Controller('v1')
export class IntellifyCollectionsController {
  constructor(private readonly reads: IntellifyReadService) {}

  @Get('clients')
  @ApiOperation({
    summary: 'Clients with headcount, lines offered and next renewal',
  })
  @ApiPagedResponse(ClientRowDto)
  clients(@Query() q: ClientsQuery) {
    return this.reads.clients(q);
  }

  @Get('products')
  @ApiOperation({ summary: 'Lines of coverage' })
  @ApiPagedResponse(ProductRowDto)
  products(@Query() q: ProductsQuery) {
    return this.reads.products(q);
  }

  @Get('funding-types')
  @ApiOperation({ summary: 'Funding types' })
  @ApiPagedResponse(FundingTypeRowDto)
  fundingTypes(@Query() q: FundingTypesQuery) {
    return this.reads.fundingTypes(q);
  }

  @Get('plan-types')
  @ApiOperation({ summary: 'Plan types by line' })
  @ApiPagedResponse(PlanTypeRowDto)
  planTypes(@Query() q: PlanTypesQuery) {
    return this.reads.planTypes(q);
  }

  @Get('carriers')
  @ApiOperation({
    summary: 'Carriers with their lines, incumbencies and final credits',
  })
  @ApiPagedResponse(CarrierRowDto)
  carriers(@Query() q: CarriersQuery) {
    return this.reads.carriers(q);
  }

  @Get('plan-designs')
  @ApiOperation({
    summary: 'Plan designs joined to their coverage and financials',
  })
  @ApiPagedResponse(PlanDesignRowDto)
  planDesigns(@Query() q: PlanDesignsQuery) {
    return this.reads.planDesigns(q);
  }

  @Get('policies')
  @ApiOperation({
    summary: 'Policies with kick-off timing and coverage counts',
  })
  @ApiPagedResponse(PolicyRowDto)
  policies(@Query() q: PoliciesQuery) {
    return this.reads.policies(q);
  }

  @Get('financials')
  @ApiOperation({ summary: 'Flattened plan financials per coverage' })
  @ApiPagedResponse(FinancialRowDto)
  financials(@Query() q: FinancialsQuery) {
    return this.reads.financials(q);
  }

  @Get('census')
  @ApiOperation({ summary: 'Census summary rows per client and year' })
  @ApiPagedResponse(CensusRowDto)
  census(@Query() q: CensusQuery) {
    return this.reads.census(q);
  }
}
