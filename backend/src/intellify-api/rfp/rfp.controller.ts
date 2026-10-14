import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPagedResponse } from '../paged';
import { CreateRfpDto } from './dto/create-rfp.dto';
import {
  CarrierInputDto,
  LineInputDto,
  MilestoneInputDto,
  RequirementInputDto,
} from './dto/list-items.dto';
import {
  DeleteRfpsQueryDto,
  ListRfpsQueryDto,
} from './dto/list-rfps-query.dto';
import { DeletedCountDto, RfpDto, RfpSummaryDto } from './dto/rfp-response.dto';
import { UpdateRfpDto } from './dto/update-rfp.dto';
import { ListBodyPipe } from './list-body.pipe';
import { RfpService } from './rfp.service';

/** RFP records, `/v1/rfps` (api.md 2.16.4, I12 and I21-I29). */
@ApiTags('rfps')
@Controller('v1/rfps')
export class RfpController {
  constructor(private readonly rfps: RfpService) {}

  @Get()
  @ApiOperation({ summary: 'RFP records, newest first' })
  @ApiPagedResponse(RfpSummaryDto)
  list(@Query() query: ListRfpsQueryDto) {
    return this.rfps.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft RFP for a client and plan year' })
  @ApiHeader({
    name: 'X-Qti-User',
    required: false,
    description: 'Who creates it, when the body has no createdBy',
  })
  @ApiCreatedResponse({ type: RfpDto })
  create(@Body() body: CreateRfpDto, @Headers('x-qti-user') user?: string) {
    return this.rfps.create(body, user);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete the drafts created by createdBy' })
  @ApiOkResponse({ type: DeletedCountDto })
  removeDrafts(@Query() query: DeleteRfpsQueryDto) {
    return this.rfps.removeDrafts(query.createdBy);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One RFP record with its lists' })
  @ApiOkResponse({ type: RfpDto })
  get(@Param('id') id: string) {
    return this.rfps.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change the header, status, stage or sections' })
  @ApiOkResponse({ type: RfpDto })
  update(@Param('id') id: string, @Body() body: UpdateRfpDto) {
    return this.rfps.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a draft' })
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    await this.rfps.remove(id);
  }

  @Put(':id/lines')
  @ApiOperation({ summary: 'Replace the lines in scope' })
  @ApiBody({ type: [LineInputDto] })
  @ApiOkResponse({ type: RfpDto })
  replaceLines(
    @Param('id') id: string,
    @Body(new ListBodyPipe(LineInputDto)) items: LineInputDto[],
  ) {
    return this.rfps.replaceLines(id, items);
  }

  @Put(':id/carriers')
  @ApiOperation({ summary: 'Replace the carriers invited' })
  @ApiBody({ type: [CarrierInputDto] })
  @ApiOkResponse({ type: RfpDto })
  replaceCarriers(
    @Param('id') id: string,
    @Body(new ListBodyPipe(CarrierInputDto)) items: CarrierInputDto[],
  ) {
    return this.rfps.replaceCarriers(id, items);
  }

  @Put(':id/requirements')
  @ApiOperation({ summary: 'Replace the requirements and questionnaire' })
  @ApiBody({ type: [RequirementInputDto] })
  @ApiOkResponse({ type: RfpDto })
  replaceRequirements(
    @Param('id') id: string,
    @Body(new ListBodyPipe(RequirementInputDto)) items: RequirementInputDto[],
  ) {
    return this.rfps.replaceRequirements(id, items);
  }

  @Put(':id/timeline')
  @ApiOperation({ summary: 'Replace the timeline' })
  @ApiBody({ type: [MilestoneInputDto] })
  @ApiOkResponse({ type: RfpDto })
  replaceTimeline(
    @Param('id') id: string,
    @Body(new ListBodyPipe(MilestoneInputDto)) items: MilestoneInputDto[],
  ) {
    return this.rfps.replaceTimeline(id, items);
  }
}
