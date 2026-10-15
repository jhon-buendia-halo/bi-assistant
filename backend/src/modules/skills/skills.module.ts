import { Module } from '@nestjs/common';
import { UserAgentsModule } from '../user-agents/user-agents.module';
import { BuiltInSkillsService } from './built-in-skills.service';
import { SkillOverridesRepository } from './repositories/skill-overrides.repository';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

/**
 * The in-app skills API (api.md 2.6.1). Storage is `SkillsRepository`,
 * provided and exported by `UserAgentsModule`, which needs it to validate,
 * copy and preview an agent's skills; this module adds the routes and the
 * rules on top without a dependency cycle.
 */
@Module({
  imports: [UserAgentsModule],
  controllers: [SkillsController],
  providers: [SkillsService, BuiltInSkillsService, SkillOverridesRepository],
  exports: [SkillsService, BuiltInSkillsService],
})
export class SkillsModule {}
