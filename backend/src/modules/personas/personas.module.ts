import { Module } from '@nestjs/common';
import { PersonasController } from './personas.controller';
import { PersonasService } from './personas.service';
import { PersonasRepository } from './repositories/personas.repository';

@Module({
  controllers: [PersonasController],
  providers: [PersonasService, PersonasRepository],
  exports: [PersonasService],
})
export class PersonasModule {}
