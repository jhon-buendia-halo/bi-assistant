import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { isLibraryTool, parseLinks } from '../../mastra/agent-links';
import { setAgentPromptOverrides } from '../../mastra/agent-prompt-overrides';
import {
  AGENT_SKILLS,
  builtInOnDemandSkillNames,
} from '../../mastra/app-skills';
import { readinessTools } from '../../mastra/tools/readiness.tools';
import { rfpTools } from '../../mastra/tools/rfp.tools';
import {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_IDENTITY_START,
  ASSISTANT_V2_TOOL_NAMES,
} from '../../mastra/agents/assistant-v2-catalog';
import { MastraService } from '../../mastra/mastra.service';
import {
  agentPromptHash,
  shippedAgentPrompt,
} from '../../mastra/shipped-agent-prompts';
import { SUPER_ADMIN } from '../../common/super-admin';
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

/** Where the RFP Builder's prompt must start (agents.md 2.8, rfp R1). */
const RFP_IDENTITY_START = 'You are the RFP Builder';

const RFP_KEY = 'rfp';

/**
 * What the RFP Builder's prompt may link (agents.md 2.8, BA-228): its own
 * tools and its own on-demand skills, one per stage. Links are mentions; it
 * keeps every tool.
 */
function rfpLinkTargets(): { tools: string[]; skills: string[] } {
  return {
    tools: Object.keys(rfpTools),
    skills: [...(AGENT_SKILLS[RFP_KEY] ?? [])],
  };
}

/** Where the Data Readiness Agent's prompt must start (agents.md 2.10, D1). */
const DATA_READINESS_IDENTITY_START = 'You are the Data Readiness Agent';

const DATA_READINESS_KEY = 'data-readiness';

/**
 * What the Data Readiness Agent's prompt may link (agents.md 2.10): its own
 * tools (the three readiness tools, `show_in_panel`, `ask_clarification`) and
 * its own skill. Links are mentions; it keeps every tool.
 */
function dataReadinessLinkTargets(): { tools: string[]; skills: string[] } {
  return {
    tools: Object.keys(readinessTools),
    skills: [...(AGENT_SKILLS[DATA_READINESS_KEY] ?? [])],
  };
}

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
      updatedBy: SUPER_ADMIN.id,
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
      linksAllowed:
        key === ASSISTANT_KEY ||
        key === ASSISTANT_V2_AGENT_KEY ||
        key === RFP_KEY ||
        key === DATA_READINESS_KEY,
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
  } else if (key === RFP_KEY) {
    if (!prompt.startsWith(RFP_IDENTITY_START)) {
      throw new BadRequestException(
        `The RFP Builder's prompt must start with "${RFP_IDENTITY_START}"`,
      );
    }
    const links = parseLinks(prompt);
    const allowed = rfpLinkTargets();
    if (links.skills.some((name) => !allowed.skills.includes(name))) {
      throw new BadRequestException(
        "Only the RFP Builder's own skills can be linked here: this prompt is shared by every user",
      );
    }
    const unknown = links.tools.find((name) => !allowed.tools.includes(name));
    if (unknown) throw new BadRequestException(`Unknown tool "${unknown}"`);
  } else if (key === DATA_READINESS_KEY) {
    if (!prompt.startsWith(DATA_READINESS_IDENTITY_START)) {
      throw new BadRequestException(
        `The Data Readiness Agent's prompt must start with "${DATA_READINESS_IDENTITY_START}"`,
      );
    }
    const links = parseLinks(prompt);
    const allowed = dataReadinessLinkTargets();
    if (links.skills.some((name) => !allowed.skills.includes(name))) {
      throw new BadRequestException(
        "Only the Data Readiness Agent's own skills can be linked here: this prompt is shared by every user",
      );
    }
    const unknown = links.tools.find((name) => !allowed.tools.includes(name));
    if (unknown) throw new BadRequestException(`Unknown tool "${unknown}"`);
  } else if (key === ASSISTANT_V2_AGENT_KEY) {
    if (!prompt.startsWith(ASSISTANT_V2_IDENTITY_START)) {
      throw new BadRequestException(
        `The Questions to Insights v2 prompt must start with "${ASSISTANT_V2_IDENTITY_START}"`,
      );
    }
    const links = parseLinks(prompt);
    if (links.skills.length) {
      throw new BadRequestException(
        "Skills can't be linked here: Questions to Insights v2 has no skills",
      );
    }
    const unknown = links.tools.find(
      (name) => !ASSISTANT_V2_TOOL_NAMES.includes(name),
    );
    if (unknown) throw new BadRequestException(`Unknown tool "${unknown}"`);
  } else if (ANY_LINK.test(prompt)) {
    throw new BadRequestException("This agent's prompt can't contain links");
  }
  return prompt;
}
