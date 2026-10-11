import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminDirectoryReader } from './admin-directory.reader';
import { AdminReadService } from './admin-read.service';
import { AdminService } from './admin.service';
import { AllOwnersAgentsRepository } from './repositories/all-owners-agents.repository';

/**
 * The Admin area's API (admin R22, R34-R68; api.md 2.15). The directory,
 * roles and activity come from the global auth module; the agents of every
 * owner from `AllOwnersAgentsRepository`, the one cross-owner reader.
 */
@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminReadService,
    AdminDirectoryReader,
    AllOwnersAgentsRepository,
  ],
})
export class AdminModule {}
