import { Module } from '@nestjs/common';
import { DatasetsModule } from '../datasets/datasets.module';
import { SkillsRepository } from '../skills/repositories/skills.repository';
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
    // The owner-scoped skills store, read to validate, copy and preview an
    // agent's skills; `SkillsModule` (which imports this one) reuses it.
    SkillsRepository,
  ],
  exports: [UserAgentsService, UserAgentsRepository, SkillsRepository],
})
export class UserAgentsModule {}
