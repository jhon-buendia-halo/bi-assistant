import { Module } from '@nestjs/common';
import { MastraService } from './mastra.service';

@Module({
  providers: [MastraService],
  exports: [MastraService],
})
export class MastraModule {}
