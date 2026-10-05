import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { AnswerPinsService } from './answer-pins.service';
import { toPinSummary } from './entities/answer-pin.entity';
import type { AnswerPinSummary } from './entities/answer-pin.entity';

/**
 * Read/clear surface over the `answer_pins` collection — a debugging and
 * data-hygiene tool (e.g. "clear every pin for this dataset after editing
 * its knowledge"), not the replay path itself (that lives entirely inside
 * `SessionsService.streamMessage`, unit D).
 */
@Controller('answer-pins')
export class AnswerPinsController {
  constructor(private readonly pins: AnswerPinsService) {}

  @Get()
  async list(
    @Query('datasetId') datasetId?: string,
  ): Promise<{ pins: AnswerPinSummary[] }> {
    const docs = await this.pins.list(datasetId);
    return { pins: docs.map(toPinSummary) };
  }

  @Delete()
  async clearForDataset(
    @Query('datasetId') datasetId?: string,
  ): Promise<{ deleted: number }> {
    if (!datasetId) return { deleted: 0 };
    return { deleted: await this.pins.deleteForDataset(datasetId) };
  }

  @Delete(':lineageKey')
  async remove(
    @Param('lineageKey') lineageKey: string,
  ): Promise<{ deleted: number }> {
    return { deleted: await this.pins.remove(lineageKey) };
  }
}
