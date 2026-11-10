import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { VisualsService } from './visuals.service';
import type { VisualChart } from './entities/visual-chart.entity';
import { CreateVisualDto } from './dto/create-visual.dto';
import { UpdateVisualDto } from './dto/update-visual.dto';

@Controller('visuals')
export class VisualsController {
  constructor(private readonly visuals: VisualsService) {}

  @Get()
  async list(): Promise<VisualChart[]> {
    return this.visuals.list();
  }

  @Post()
  async create(@Body() dto: CreateVisualDto): Promise<VisualChart> {
    return this.visuals.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVisualDto,
  ): Promise<VisualChart> {
    return this.visuals.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.visuals.delete(id);
  }
}
