import { Module } from '@nestjs/common';
import { DatasourcesModule } from '../datasources/datasources.module';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';
import { SandboxRepository } from './repositories/sandbox.repository';

@Module({
  imports: [DatasourcesModule],
  controllers: [SandboxController],
  providers: [SandboxService, SandboxRepository],
  exports: [SandboxRepository],
})
export class SandboxModule {}
