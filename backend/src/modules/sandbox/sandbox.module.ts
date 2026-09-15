import { Module } from '@nestjs/common';
import { SandboxController } from './sandbox.controller';
import { SandboxRepository } from './repositories/sandbox.repository';

@Module({
  controllers: [SandboxController],
  providers: [SandboxRepository],
  exports: [SandboxRepository],
})
export class SandboxModule {}
