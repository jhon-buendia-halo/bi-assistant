import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { Skill, SkillInput, SkillSummary } from './entities/skill.entity';
import type {
  BuiltInSkill,
  BuiltInSkillInput,
  BuiltInSkillSummary,
} from './entities/skill-override.entity';
import { BuiltInSkillsService } from './built-in-skills.service';
import { SkillsService } from './skills.service';

/** Style A answer of the skill routes (api.md 96-98). */
interface SkillResult<T = Skill> {
  ok: boolean;
  message: string;
  skill?: T;
}

/** The in-app skills of the caller (api.md 2.6.1, R68-R74). */
@Controller('skills')
export class SkillsController {
  constructor(
    private readonly skills: SkillsService,
    private readonly builtIns: BuiltInSkillsService,
  ) {}

  @Get()
  async list(): Promise<{ skills: SkillSummary[] }> {
    return { skills: await this.skills.list() };
  }

  // The `built-in` routes come before `:id` so the name is not read as an id.
  @Get('built-in')
  async listBuiltIn(): Promise<{ skills: BuiltInSkillSummary[] }> {
    return { skills: await this.builtIns.list() };
  }

  @Get('built-in/:name')
  getBuiltIn(@Param('name') name: string): Promise<BuiltInSkill> {
    return this.builtIns.get(name);
  }

  @Put('built-in/:name')
  saveBuiltIn(
    @Param('name') name: string,
    @Body() body: BuiltInSkillInput,
  ): Promise<SkillResult<BuiltInSkill>> {
    return styleA(async () => ({
      message: `Built-in skill "${name}" saved`,
      skill: await this.builtIns.save(name, body),
    }));
  }

  @Delete('built-in/:name')
  resetBuiltIn(
    @Param('name') name: string,
  ): Promise<SkillResult<BuiltInSkill>> {
    return styleA(async () => {
      await this.builtIns.reset(name);
      return { message: `Built-in skill "${name}" reset` };
    });
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Skill> {
    return this.skills.get(id);
  }

  @Post()
  create(@Body() body: SkillInput): Promise<SkillResult> {
    return styleA(async () => {
      const skill = await this.skills.create(body);
      return { message: `Skill "${skill.name}" created`, skill };
    });
  }

  @Put(':id')
  save(
    @Param('id') id: string,
    @Body() body: SkillInput,
  ): Promise<SkillResult> {
    return styleA(async () => ({
      message: 'Skill saved',
      skill: await this.skills.save(id, body),
    }));
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<SkillResult> {
    return styleA(async () => {
      const skill = await this.skills.delete(id);
      return { message: `Skill "${skill.name}" deleted` };
    });
  }
}

/** Run a mutation and fold thrown errors into `{ ok: false, message }`. */
async function styleA<T = Skill>(
  run: () => Promise<{ message: string; skill?: T }>,
): Promise<SkillResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
