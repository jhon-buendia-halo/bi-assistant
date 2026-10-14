import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { isLibraryTool, parseLinks } from '../../mastra/agent-links';
import { setAgentPromptOverrides } from '../../mastra/agent-prompt-overrides';
import { builtInOnDemandSkillNames } from '../../mastra/app-skills';
import { MastraService } from '../../mastra/mastra.service';
import {
  agentPromptHash,
  shippedAgentPrompt,
} from '../../mastra/shipped-agent-prompts';
import { CurrentUserService } from '../auth/current-user.service';
import { UserAgentsService } from '../user-agents/user-agents.service';
import type {
  AgentPromptOverrideDoc,
  AgentPromptView,
} from './entities/agent-prompt-override.entity';
import { AgentPromptOverridesRepository } from './repositories/agent-prompt-overrides.repository';

/** The most characters a system prompt may have. */
export const PROMPT_MAX_CHARS = 20000;

/** Where the assistant's prompt must start (ADR-0008, kept by ADR-0026). */
const ASSISTANT_IDENTITY_START = 'You are the Questions to Insights assistant';

const ASSISTANT_KEY = 'assistant';

/** Any `[[…]]` link. */
const ANY_LINK = /\[\[.*?\]\]/;

/**
 * Built-in agents' system prompts edited in the app (ADR-0026): an org-wide
 * override per registry key, stored in `agent_prompt_overrides`. The current
 * overrides are mirrored into the `agent-prompt-overrides` bridge, which the
 * agents read per call, so a save or reset applies to the next call.
 */
@Injectable()
export class AgentPromptsService implements OnModuleInit {
  constructor(
    private readonly repository: AgentPromptOverridesRepository,
    private readonly users: CurrentUserService,
    private readonly mastra: MastraService,
    private readonly userAgents: UserAgentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** The `prompt` of a built-in agent's detail; undefined for any other key. */
  async view(key: string): Promise<AgentPromptView | undefined> {
    const shipped = shippedAgentPrompt(key);
    if (shipped === undefined) return undefined;
    return this.viewOf(key, shipped, await this.repository.get(key));
  }

  /**
   * Save the override of `key`, validated in the order of api.md 103.
   * Returns the agent's display name. Throws the refusal otherwise.
   */
  async save(key: string, input: { prompt?: unknown }): Promise<string> {
    const shipped = await this.requireBuiltIn(key);
    const prompt = validatePrompt(key, input?.prompt);
    await this.repository.save({
      key,
      prompt,
      baseHash: agentPromptHash(shipped),
      updatedBy: this.users.current()?.id ?? 'local',
    });
    await this.refresh();
    return this.nameOf(key);
  }

  /** Delete the override of `key`, if any (api.md 104). Returns the name. */
  async reset(key: string): Promise<string> {
    await this.requireBuiltIn(key);
    await this.repository.delete(key);
    await this.refresh();
    return this.nameOf(key);
  }

  /** Reload every override into the bridge the agents read. */
  private async refresh(): Promise<void> {
    setAgentPromptOverrides(await this.repository.list());
  }

  private nameOf(key: string): string {
    return this.mastra.listAgents()[key]?.name ?? key;
  }

  /** The shipped prompt of built-in `key`; refuses a user agent or a stranger. */
  private async requireBuiltIn(key: string): Promise<string> {
    const shipped = shippedAgentPrompt(key);
    if (shipped !== undefined) return shipped;
    if (await this.userAgents.get(key)) {
      throw new BadRequestException(
        "Only built-in agents have a shared system prompt; edit a user agent's instructions instead",
      );
    }
    throw new NotFoundException(`Agent "${key}" not found`);
  }

  private viewOf(
    key: string,
    shipped: string,
    override: AgentPromptOverrideDoc | null,
  ): AgentPromptView {
    return {
      editable: override?.prompt ?? shipped,
      shipped,
      modified: !!override,
      builtInChanged:
        !!override && override.baseHash !== agentPromptHash(shipped),
      linksAllowed: key === ASSISTANT_KEY,
      updatedAt: override?.updatedAt ?? null,
    };
  }
}

/** The prompt to store (trimmed), or the first refusal that applies (api.md 103). */
function validatePrompt(key: string, value: unknown): string {
  const prompt = typeof value === 'string' ? value.trim() : '';
  if (!prompt) throw new BadRequestException('The prompt is empty');
  if (prompt.length > PROMPT_MAX_CHARS) {
    throw new BadRequestException('The prompt is at most 20,000 characters');
  }
  if (key === ASSISTANT_KEY) {
    if (!prompt.startsWith(ASSISTANT_IDENTITY_START)) {
      throw new BadRequestException(
        `The assistant's prompt must start with "${ASSISTANT_IDENTITY_START}"`,
      );
    }
    const links = parseLinks(prompt);
    const builtIn = builtInOnDemandSkillNames();
    if (links.skills.some((name) => !builtIn.includes(name))) {
      throw new BadRequestException(
        'Only built-in skills can be linked here: this prompt is shared by every user',
      );
    }
    const unknown = links.tools.find((name) => !isLibraryTool(name));
    if (unknown) throw new BadRequestException(`Unknown tool "${unknown}"`);
  } else if (ANY_LINK.test(prompt)) {
    throw new BadRequestException("This agent's prompt can't contain links");
  }
  return prompt;
}
