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
import { PersonasService } from './personas.service';
import type { UserPersona } from './entities/user-persona.entity';
import { CreatePersonaDto } from './dto/create-persona.dto';
import { UpdatePersonaDto } from './dto/update-persona.dto';

@Controller('personas')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  async list(): Promise<UserPersona[]> {
    return this.personas.list();
  }

  @Post()
  async create(@Body() dto: CreatePersonaDto): Promise<UserPersona> {
    return this.personas.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePersonaDto,
  ): Promise<UserPersona> {
    return this.personas.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.personas.delete(id);
  }
}
