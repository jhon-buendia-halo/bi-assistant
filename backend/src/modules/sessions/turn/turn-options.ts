// What reaches the model on a turn (agents.md 4.1, 4.2): each agent's system
// context blocks, its requestContext keys, its memory thread and the input.
import { RequestContext } from '@mastra/core/request-context';
import { INSIGHTS_ANALYST_MAX_STEPS } from '../../../mastra/agents/insights-analyst-catalog';
import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_MAX_STEPS,
} from '../../../mastra/agents/insights-lead-catalog';
import type { MastraService } from '../../../mastra/mastra.service';
import {
  AGENT_OVERRIDES_CONTEXT_KEY,
  type AgentOverrides,
} from '../../../mastra/model-resolver';
import {
  AGENT_TOOLS_CONTEXT_KEY,
  isFullSelection,
  toolSelectionFrom,
} from '../../../mastra/agent-tools';
import {
  AGENT_SKILLS_CONTEXT_KEY,
  type AgentSkill,
} from '../../../mastra/agent-skills';
import { effectiveOptionalTools } from '../../../mastra/agent-links';
import { DATASETS_CONTEXT_KEY } from '../../../mastra/tools/dataset.tools';
import {
  SESSION_ID_CONTEXT_KEY,
  TURN_QUESTION_CONTEXT_KEY,
} from '../../../mastra/tools/turn-context';
import {
  entityOrientationLines,
  knowledgeContext,
} from '../../../mastra/context-blocks';
import { toSkillCopy } from '../../skills/entities/skill.entity';
import type { UserAgentsService } from '../../user-agents/user-agents.service';
import type { AgentConfig } from '../../user-agents/entities/user-agent.entity';
import type { LlmService } from '../../llm/llm.service';
import type { VerifiedQueriesService } from '../../verified-queries/verified-queries.service';
import type { MetricsService } from '../../metrics/metrics.service';
import type { OntologyService } from '../../ontology/ontology.service';
import type { SessionDoc } from '../entities/session.entity';
import {
  KNOWLEDGE_USED_CONTEXT_KEY,
  agentInstructionsBlock,
} from './turn-records';
import { SessionDatasets, turnProviderOptions } from './session-datasets';

/** What the turn options are built from: the session service's dependencies. */
export interface TurnOptionsDeps {
  llmService: LlmService;
  verifiedQueries: VerifiedQueriesService;
  metrics: MetricsService;
  knowledge: OntologyService;
  userAgents: UserAgentsService;
  datasets: SessionDatasets;
  /** `names` without the datasets that no longer exist, in order. */
  existingDatasets(names: string[]): Promise<string[]>;
  /** Persist a patch on the session or in-memory host. */
  updateDoc(id: string, patch: Partial<SessionDoc>): Promise<unknown>;
}

export class TurnOptions {
  constructor(private readonly deps: TurnOptionsDeps) {}

  /**
   * The configuration a session's turns apply: the Live version of the agent
   * it was started from, or the draft for a preview; undefined for a plain
   * session or a deleted agent. A preview's datasets follow its draft. A
   * session re-stamps `agentName` when the agent was renamed, so a later
   * deletion still names it (R59).
   */
  private async agentConfigFor(
    session: SessionDoc,
  ): Promise<AgentConfig | undefined> {
    if (!session.agentId) return undefined;
    const doc = await this.deps.userAgents.get(session.agentId);
    if (session.preview) {
      if (!doc) return undefined;
      session.datasets = await this.deps.existingDatasets(doc.draft.datasets);
      await this.deps.updateDoc(session.id, { datasets: session.datasets });
      return doc.draft;
    }
    const live = doc?.live;
    if (live && session.agentName !== live.name) {
      await this.deps.updateDoc(session.id, { agentName: live.name });
      session.agentName = live.name;
    }
    return live;
  }

  /**
   * The skills a session's turns carry (agents.md 4.2): the `liveSkills`
   * copies of the agent it was started from, or for a preview the current
   * skills its draft names; none once the agent is gone.
   */
  private async agentSkillsFor(session: SessionDoc): Promise<AgentSkill[]> {
    const doc = session.agentId
      ? await this.deps.userAgents.get(session.agentId)
      : null;
    if (!doc) return [];
    if (session.preview) {
      return (await this.deps.userAgents.skillsFor(doc.draft.skills)).map(
        toSkillCopy,
      );
    }
    return doc.live ? (doc.liveSkills ?? []) : [];
  }

  /**
   * A turn's options: Elena's (below), else Michael's with the session's
   * memory thread, for any other agent a host runs (a node chat's).
   */
  async agentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
  ) {
    // Elena (plan Elena 2.3): Michael's context, her own budget, and no
    // memory thread (the run host sends the conversation as a transcript).
    // On a user agent's host she runs its definition (ADR-0059), read
    // first: a preview's datasets follow its draft.
    if (session.agentKey === INSIGHTS_LEAD_AGENT_KEY) {
      const agent = session.agentId
        ? await this.agentConfigFor(session)
        : undefined;
      const { memory: _memory, ...options } = await this.analystAgentOptions(
        session,
        question,
        abortSignal,
        INSIGHTS_LEAD_MAX_STEPS,
        agent,
      );
      void _memory;
      return options;
    }
    return this.analystAgentOptions(
      session,
      question,
      abortSignal,
      INSIGHTS_ANALYST_MAX_STEPS,
    );
  }

  /**
   * A turn of Insights Analyst (agents.md 2.11, 4.1, 4.2), and of Elena
   * with `maxSteps` her budget (plan Elena 2.3): Block 1's
   * dataset half with the `sample_rows` hint (no visuals lines), then the
   * governed metrics, curated knowledge and verified-query blocks, built by
   * the same services and in the same order as the assistant's (no
   * agent-instructions block), and the `datasets`, `session-id`,
   * `turn-question` and `knowledge-used` keys. With a user agent (`agent`,
   * Elena on its host; ADR-0059) also its overrides, tool selection and
   * in-app skills on the context, its effort and model in the provider
   * options, and its instructions as Block 5, last.
   */
  private async analystAgentOptions(
    session: SessionDoc,
    question: string | undefined,
    abortSignal: AbortSignal | undefined,
    maxSteps: number,
    agent?: AgentConfig,
  ) {
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, session.datasets);
    requestContext.set(SESSION_ID_CONTEXT_KEY, session.id);
    if (question) requestContext.set(TURN_QUESTION_CONTEXT_KEY, question);
    const datasets = await this.deps.datasets.bound(session.datasets);
    const { reasoningEffort } = await this.deps.llmService.getView();
    const verified = question
      ? await this.deps.verifiedQueries.referenceBlock(question)
      : undefined;
    const metrics = await this.deps.metrics.definitionBlock(
      datasets.flatMap((s) => s.tables ?? []),
    );
    const knowledge = await this.deps.knowledge.contextFor(session.datasets);
    // The answer records the knowledge the model saw (agents.md 4.1 Block 3).
    requestContext.set(KNOWLEDGE_USED_CONTEXT_KEY, knowledge.used);
    const overrides: AgentOverrides = {
      ...(agent?.model ? { model: agent.model } : {}),
      ...(agent?.reasoningEffort
        ? { reasoningEffort: agent.reasoningEffort }
        : {}),
    };
    if (overrides.model || overrides.reasoningEffort) {
      requestContext.set(AGENT_OVERRIDES_CONTEXT_KEY, overrides);
    }
    const agentSkills = agent ? await this.agentSkillsFor(session) : [];
    // The tools offered are those the instructions link plus those its
    // skills link (ADR-0024); a config without `tools` keeps every tool.
    if (agent?.tools) {
      const tools = effectiveOptionalTools(agent.tools, agentSkills);
      if (!isFullSelection(tools)) {
        requestContext.set(AGENT_TOOLS_CONTEXT_KEY, tools);
      }
    }
    if (agentSkills.length) {
      requestContext.set(AGENT_SKILLS_CONTEXT_KEY, agentSkills);
    }
    return {
      maxSteps,
      providerOptions: await turnProviderOptions(
        { reasoningEffort: overrides.reasoningEffort ?? reasoningEffort },
        overrides.model,
      ),
      context: [
        {
          role: 'system' as const,
          // Its tools: `sample_rows` unless a user agent's selection leaves
          // it out; no visuals (agents.md 2.11).
          content: entityOrientationLines(
            session.datasets,
            datasets,
            toolSelectionFrom(requestContext),
          ).join('\n'),
        },
        ...(metrics ? [{ role: 'system' as const, content: metrics }] : []),
        // Its rules are the on-demand curated-knowledge skill (ADR-0025).
        ...knowledgeContext(knowledge.block),
        ...(verified ? [{ role: 'system' as const, content: verified }] : []),
        // Last, so her prompt and every curated block come first; the
        // engine's catalogue, plan and repair blocks go after it.
        ...(agent?.instructions.trim()
          ? [
              {
                role: 'system' as const,
                content: agentInstructionsBlock(agent),
              },
            ]
          : []),
      ],
      requestContext,
      abortSignal,
      memory: { thread: session.id, resource: session.id },
    };
  }

  /**
   * Mastra stores new turns itself once a session thread exists. For sessions
   * created before memory was enabled, bootstrap the thread once from the
   * already-persisted session transcript.
   */
  async agentInput(
    agent: ReturnType<MastraService['getAgent']>,
    session: SessionDoc,
  ) {
    const memory = await agent.getMemory();
    const thread = await memory?.getThreadById({ threadId: session.id });
    const latest = session.messages.at(-1);
    const previous = session.messages.at(-2);
    if (thread && latest?.role === 'user') {
      // A clarification ends its turn before memory sees the question, so
      // replay it alongside the user's answer. A follow-up run's copied
      // thread holds the earlier analysis but not the answer Write answer
      // gave, so replay that too (agents.md 5.14).
      if (
        previous?.role === 'assistant' &&
        (previous.clarification || session.continuesThreads)
      ) {
        return [
          { role: 'assistant' as const, content: previous.content },
          { role: 'user' as const, content: latest.content },
        ];
      }
      return latest.content;
    }

    return this.transcriptInput(session);
  }

  /**
   * The whole transcript as plain text messages: a turn's input when its
   * thread does not exist yet, and always the Plan step's (agents.md 5.11).
   */
  transcriptInput(session: SessionDoc) {
    return session.messages.map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, content: message.content }
        : { role: 'assistant' as const, content: message.content },
    );
  }
}
