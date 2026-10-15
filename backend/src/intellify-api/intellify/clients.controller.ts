import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ClientCensusQuery,
  ClientFinancialsQuery,
  ClientReadQuery,
  ProgramQuery,
} from './intellify.dto';
import { IntellifyReadService } from './intellify-read.service';

const ONE_CODE = ApiParam({
  name: 'oneCode',
  description: "The client's one_code",
});
const OBJECT = ApiOkResponse({ schema: { type: 'object' } });

/**
 * Per-client reads (api.md 2.16.3, I13-I20). Not paged and not tables: they
 * have a path parameter, so REST discovery leaves them out on purpose.
 */
@ApiTags('intellify')
@Controller('v1/clients/:oneCode')
export class IntellifyClientsController {
  constructor(private readonly reads: IntellifyReadService) {}

  @Get()
  @ONE_CODE
  @OBJECT
  @ApiOperation({ summary: 'One client with contacts and lines' })
  client(@Param('oneCode') oneCode: string, @Query() q: ClientReadQuery) {
    return this.reads.clientDetail(oneCode, q);
  }

  @Get('renewals')
  @ONE_CODE
  @OBJECT
  @ApiOperation({
    summary:
      'Renewal calendar: effective date is 1 January after plan_financial.planYear',
  })
  renewals(@Param('oneCode') oneCode: string, @Query() q: ClientReadQuery) {
    return this.reads.renewals(oneCode, q);
  }

  @Get('program')
  @ONE_CODE
  @OBJECT
  @ApiOperation({ summary: 'The current benefits program, by line' })
  program(@Param('oneCode') oneCode: string, @Query() q: ProgramQuery) {
    return this.reads.program(oneCode, q);
  }

  @Get('plans/:planDesignId')
  @ONE_CODE
  @ApiParam({ name: 'planDesignId' })
  @OBJECT
  @ApiOperation({ summary: 'One plan design in full' })
  plan(
    @Param('oneCode') oneCode: string,
    @Param('planDesignId') planDesignId: string,
    @Query() q: ClientReadQuery,
  ) {
    return this.reads.plan(oneCode, planDesignId, q);
  }

  @Get('financials')
  @ONE_CODE
  @OBJECT
  @ApiOperation({ summary: 'Financial rows and totals for a plan year' })
  financials(
    @Param('oneCode') oneCode: string,
    @Query() q: ClientFinancialsQuery,
  ) {
    return this.reads.clientFinancials(oneCode, q);
  }

  @Get('census')
  @ONE_CODE
  @OBJECT
  @ApiOperation({
    summary: 'Census of a year with breakdowns and plan mapping',
  })
  census(@Param('oneCode') oneCode: string, @Query() q: ClientCensusQuery) {
    return this.reads.clientCensus(oneCode, q);
  }

  @Get('commercials')
  @ONE_CODE
  @OBJECT
  @ApiOperation({
    summary: 'Contributions, carrier credits, fees, survey, point solutions',
  })
  commercials(@Param('oneCode') oneCode: string, @Query() q: ClientReadQuery) {
    return this.reads.commercials(oneCode, q);
  }

  @Get('wizards')
  @ONE_CODE
  @OBJECT
  @ApiOperation({ summary: 'Wizards and the alternate plans they propose' })
  wizards(@Param('oneCode') oneCode: string, @Query() q: ClientReadQuery) {
    return this.reads.wizards(oneCode, q);
  }
}
