import { Module } from '@nestjs/common';
import { DatasetsModule } from '../datasets/datasets.module';
import { BuiltinAgentPinsRepository } from './repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from './repositories/user-agents.repository';
import { UserAgentsService } from './user-agents.service';

/**
 * Storage and lifecycle of user agents. A leaf module with no controller:
 * `AgentsModule` serves the HTTP routes, and `SessionsModule` can import it
 * without the cycle importing `AgentsModule` would create.
 */
@Module({
  imports: [DatasetsModule],
  providers: [
    UserAgentsService,
    UserAgentsRepository,
    BuiltinAgentPinsRepository,
  ],
  exports: [UserAgentsService],
})
export class UserAgentsModule {}
