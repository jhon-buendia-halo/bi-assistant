// What reaches the model on a turn (agents.md 4.1, 4.2): each agent's system
// context blocks, its requestContext keys, its memory thread and the input.
import type { Logger } from '@nestjs/common';
import { RequestContext } from '@mastra/core/request-context';
import {
  RFP_CREATED_BY_CONTEXT_KEY,
  TURN_RFP_CONTEXT_KEY,
  isoToday,
  rfpOrientationBlock,
  type RfpOrientationRecord,
  type TurnRfpHolder,
} from '../../../mastra/rfp-context';
import {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_MAX_STEPS,
} from '../../../mastra/agents/assistant-v2-catalog';
import type { MastraService } from '../../../mastra/mastra.service';
import {
  AGENT_OVERRIDES_CONTEXT_KEY,
  type AgentOverrides,
} from '../../../mastra/model-resolver';
import {
  AGENT_TOOLS_CONTEXT_KEY,
  isFullSelection,
  selects,
  toolSelectionFrom,
} from '../../../mastra/agent-tools';
import {
  AGENT_SKILLS_CONTEXT_KEY,
  type AgentSkill,
} from '../../../mastra/agent-skills';
import { effectiveOptionalTools } from '../../../mastra/agent-links';
import { ASSISTANT_MAX_STEPS } from '../../../mastra/agent-constants';
import { DATASETS_CONTEXT_KEY } from '../../../mastra/tools/dataset.tools';
import {
  ACTIVE_VISUAL_CONTEXT_KEY,
  SESSION_ID_CONTEXT_KEY,
  TURN_QUESTION_CONTEXT_KEY,
} from '../../../mastra/tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../../../mastra/session-workspaces';
import {
  entityOrientationLines,
  knowledgeContext,
} from '../../../mastra/context-blocks';
import { SUPER_ADMIN } from '../../../common/super-admin';
import { toSkillCopy } from '../../skills/entities/skill.entity';
import type { UserAgentsService } from '../../user-agents/user-agents.service';
import type { AgentConfig } from '../../user-agents/entities/user-agent.entity';
import type { LlmService } from '../../llm/llm.service';
import type { VerifiedQueriesService } from '../../verified-queries/verified-queries.service';
import type { MetricsService } from '../../metrics/metrics.service';
import type { OntologyService } from '../../ontology/ontology.service';
import type { RfpPackagesService } from '../../rfp-packages/rfp-packages.service';
import type { VisualizationService } from '../visualization.service';
import {
  DATA_READINESS_AGENT_KEY,
  READINESS_MAX_STEPS,
  readinessOrientationBlock,
} from '../readiness-bridge';
import type { SessionDoc } from '../entities/session.entity';
import {
  KNOWLEDGE_USED_CONTEXT_KEY,
  RFP_AGENT_KEY,
  agentInstructionsBlock,
} from './turn-records';
import { SessionDatasets, turnProviderOptions } from './session-datasets';

/** What the turn options are built from: the session service's dependencies. */
export interface TurnOptionsDeps {
  mastra: MastraService;
  llmService: LlmService;
  visuals: VisualizationService;
  verifiedQueries: VerifiedQueriesService;
  metrics: MetricsService;
  knowledge: OntologyService;
  userAgents: UserAgentsService;
  rfpPackages?: RfpPackagesService;
  datasets: SessionDatasets;
  logger: Logger;
  /** `names` without the datasets that no longer exist, in order. */
  existingDatasets(names: string[]): Promise<string[]>;
  /** Persist a patch on the session or in-memory host. */
  updateDoc(id: string, patch: Partial<SessionDoc>): Promise<unknown>;
}

export class TurnOptions {
  constructor(private readonly deps: TurnOptionsDeps) {}

  /**
   * Hybrid context: a cheap orientation block (dataset names + entity keys,
   * the session's visuals and which one is open), the curated metric
   * definitions covering those entities, the curated knowledge-store
   * snippets covering this session's datasets, plus any user-approved
   * question → SQL pairs resembling `question`, in the system context, and
   * requestContext scoping the tools to this session.
   *
   * Memory-free on purpose — `agentOptions` adds the session's conversation
   * thread, `backgroundAgentOptions` deliberately does not.
   */
  async agentContext(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
  ) {
    // A session started from a user agent runs with the agent's current Live
    // version (sessions-chat R54), a preview with its draft (agents-evals
    // R60); once the agent is gone it is the plain assistant (R59).
    const agent = await this.agentConfigFor(session);
    const datasets = await this.deps.datasets.bound(session.datasets);
    const visualLines = (session.visualizations ?? []).map(
      (v) =>
        `- ${v.id} — "${v.title}" v${this.deps.visuals.currentVersion(v)} (from the answer at ${v.sourceMessageAt})`,
    );
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, session.datasets);
    requestContext.set(SESSION_ID_CONTEXT_KEY, session.id);
    if (question) requestContext.set(TURN_QUESTION_CONTEXT_KEY, question);
    if (activeVisualId) {
      requestContext.set(ACTIVE_VISUAL_CONTEXT_KEY, activeVisualId);
    }
    const workspace = await this.deps.mastra.ensureSessionWorkspace(
      session.id,
      session.name,
    );
    requestContext.set(SESSION_WORKSPACE_CONTEXT_KEY, workspace.id);
    const { reasoningEffort } = await this.deps.llmService.getView();
    const verified = question
      ? await this.deps.verifiedQueries.referenceBlock(question)
      : undefined;
    // Curated semantics for the entities this session can see — the one
    // definition of each business number, never re-derived per turn.
    const metrics = await this.deps.metrics.definitionBlock(
      datasets.flatMap((s) => s.tables ?? []),
    );
    // Curated, user-authored knowledge (glossary/instructions/default
    // filters) for this session's datasets — authoritative over anything
    // the model would otherwise infer from schema alone.
    const knowledge = await this.deps.knowledge.contextFor(session.datasets);
    // Threaded on requestContext rather than returned alongside the options,
    // because the options object is spread straight into the agent call.
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
    // The agent's tool selection (ADR-0022): only a list without all three
    // optional tools goes on the context; otherwise every tool is offered.
    // The agent's in-app skills join the assistant's catalog (ADR-0022): the
    // copies its Live version runs on, or for a preview the current skills.
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
    const selection = toolSelectionFrom(requestContext);
    const visualsBlock = selects(selection, 'visuals')
      ? [
          '',
          'Interactive visuals in this session (id — title, current version):',
          ...(visualLines.length ? visualLines : ['(none yet)']),
          activeVisualId
            ? `Visual currently open in the right panel: ${activeVisualId}.`
            : 'No visual is open in the right panel.',
        ]
      : [];
    return {
      // Analysis often chains several schema + SQL tool calls per turn.
      maxSteps: ASSISTANT_MAX_STEPS,
      // The user-configured reasoning effort (Low/Medium/High chip), unless
      // the session's agent overrides it.
      providerOptions: await turnProviderOptions(
        { reasoningEffort: overrides.reasoningEffort ?? reasoningEffort },
        overrides.model,
      ),
      context: [
        {
          role: 'system' as const,
          content: [
            ...entityOrientationLines(session.datasets, datasets, selection),
            ...visualsBlock,
          ].join('\n'),
        },
        ...(metrics ? [{ role: 'system' as const, content: metrics }] : []),
        // The knowledge block; its rules are the on-demand curated-knowledge
        // skill (ADR-0025).
        ...knowledgeContext(knowledge.block),
        ...(verified ? [{ role: 'system' as const, content: verified }] : []),
        // Last, so the base prompt and every curated block come first.
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
    };
  }

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

  /** Chat turns: the shared grounding plus this session's memory thread. */
  async agentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
  ) {
    // A session bound to the RFP Builder gets its own context (ADR-0028).
    if (session.agentKey === RFP_AGENT_KEY) {
      return this.rfpAgentOptions(session, question, abortSignal);
    }
    if (session.agentKey === DATA_READINESS_AGENT_KEY) {
      return this.readinessAgentOptions(session, question, abortSignal);
    }
    if (session.agentKey === ASSISTANT_V2_AGENT_KEY) {
      return this.assistantV2AgentOptions(session, question, abortSignal);
    }
    return {
      ...(await this.agentContext(
        session,
        question,
        abortSignal,
        activeVisualId,
      )),
      // Each session is an isolated, persistent Mastra conversation.
      memory: { thread: session.id, resource: session.id },
    };
  }

  /**
   * A turn of Questions to Insights v2 (agents.md 2.11, 4.1, 4.2): Block 1's
   * dataset half only, with the hint of a call without `sample_rows` (no
   * visuals, metrics, knowledge, verified-query or agent-instructions
   * block), and only the `datasets`, `session-id` and `turn-question` keys.
   */
  private async assistantV2AgentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
  ) {
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, session.datasets);
    requestContext.set(SESSION_ID_CONTEXT_KEY, session.id);
    if (question) requestContext.set(TURN_QUESTION_CONTEXT_KEY, question);
    const datasets = await this.deps.datasets.bound(session.datasets);
    const { reasoningEffort } = await this.deps.llmService.getView();
    return {
      maxSteps: ASSISTANT_V2_MAX_STEPS,
      providerOptions: await turnProviderOptions({ reasoningEffort }),
      context: [
        {
          role: 'system' as const,
          // An empty selection: neither `sample_rows` nor the visuals.
          content: entityOrientationLines(session.datasets, datasets, []).join(
            '\n',
          ),
        },
      ],
      requestContext,
      abortSignal,
      memory: { thread: session.id, resource: session.id },
    };
  }

  /**
   * A turn of the RFP Builder (agents.md 4.1, 4.2, 5.1): Block R1 only, no
   * metrics, knowledge, verified-query or agent-instructions block, and the
   * `rfp` requestContext keys, with a fresh `turn-rfp` holder per turn.
   */
  private async rfpAgentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
  ) {
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, session.datasets);
    requestContext.set(SESSION_ID_CONTEXT_KEY, session.id);
    if (question) requestContext.set(TURN_QUESTION_CONTEXT_KEY, question);
    const workspace = await this.deps.mastra.ensureSessionWorkspace(
      session.id,
      session.name,
    );
    requestContext.set(SESSION_WORKSPACE_CONTEXT_KEY, workspace.id);
    requestContext.set(RFP_CREATED_BY_CONTEXT_KEY, SUPER_ADMIN.id);
    const turnRfp: TurnRfpHolder = {};
    requestContext.set(TURN_RFP_CONTEXT_KEY, turnRfp);
    const { reasoningEffort } = await this.deps.llmService.getView();
    return {
      maxSteps: ASSISTANT_MAX_STEPS,
      providerOptions: await turnProviderOptions({ reasoningEffort }),
      context: [
        {
          role: 'system' as const,
          content: await this.rfpOrientation(session),
        },
      ],
      requestContext,
      abortSignal,
      memory: { thread: session.id, resource: session.id },
    };
  }

  /**
   * A turn of the Data Readiness Agent (agents.md 2.10, 4.1, 4.2): Block D1
   * only, its requestContext keys and no workflow (ADR-0031).
   */
  private async readinessAgentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
  ) {
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, session.datasets);
    requestContext.set(SESSION_ID_CONTEXT_KEY, session.id);
    if (question) requestContext.set(TURN_QUESTION_CONTEXT_KEY, question);
    const workspace = await this.deps.mastra.ensureSessionWorkspace(
      session.id,
      session.name,
    );
    requestContext.set(SESSION_WORKSPACE_CONTEXT_KEY, workspace.id);
    const { reasoningEffort } = await this.deps.llmService.getView();
    return {
      maxSteps: READINESS_MAX_STEPS,
      providerOptions: await turnProviderOptions({ reasoningEffort }),
      context: [
        {
          role: 'system' as const,
          content: await this.readinessOrientation(session),
        },
      ],
      requestContext,
      abortSignal,
      memory: { thread: session.id, resource: session.id },
    };
  }

  /** Block D1 (agents.md 4.1): each session dataset, its datasource and size. */
  private async readinessOrientation(session: SessionDoc): Promise<string> {
    const datasets = await this.deps.datasets.bound(session.datasets);
    const rows = await Promise.all(
      session.datasets
        .map((name) => datasets.find((dataset) => dataset.name === name))
        .filter((dataset) => dataset !== undefined)
        .map(async (dataset) => ({
          name: dataset.name,
          datasourceKind: dataset.datasourceKind,
          datasourceName: dataset.datasourceId
            ? await this.deps.datasets.datasourceName(dataset.datasourceId)
            : 'none',
          datasourceId: dataset.datasourceId,
          entityCount: dataset.tables.length,
          exampleEntity: dataset.tables[0],
        })),
    );
    return readinessOrientationBlock(rows, isoToday());
  }

  /**
   * Block R1 (agents.md 4.1): the REST datasource the RFP tools resolve, the
   * session's active RFP read from the API when the turn starts, and today.
   * An RFP that can't be read is reported as none active, never as an error.
   */
  private async rfpOrientation(session: SessionDoc): Promise<string> {
    const datasource = await this.rfpDatasource(session);
    if (!datasource) {
      return [
        'Intellify RFP API for this session: none (no dataset of this session is bound to a REST datasource).',
        'No RFP is active in this session yet: start at stage 1.',
        `Today is ${isoToday()}.`,
      ].join('\n');
    }
    let rfp: RfpOrientationRecord | undefined;
    if (session.rfpId && this.deps.rfpPackages) {
      try {
        rfp = (await this.deps.rfpPackages.getJson(
          datasource.id,
          `/v1/rfps/${encodeURIComponent(session.rfpId)}`,
        )) as RfpOrientationRecord;
      } catch (error) {
        this.deps.logger.warn(
          `Could not read the active RFP ${session.rfpId} of session ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return rfpOrientationBlock({
      datasourceId: datasource.id,
      datasourceName: datasource.name,
      ...(rfp ? { rfp: { ...rfp, id: rfp.id ?? session.rfpId } } : {}),
      today: isoToday(),
    });
  }

  /** The first of the session's datasets bound to a REST datasource. */
  private async rfpDatasource(
    session: SessionDoc,
  ): Promise<{ id: string; name: string } | undefined> {
    const datasets = await this.deps.datasets.bound(session.datasets);
    const rest = session.datasets
      .map((name) => datasets.find((dataset) => dataset.name === name))
      .find((dataset) => dataset?.datasourceKind === 'rest');
    if (!rest?.datasourceId) return undefined;
    return {
      id: rest.datasourceId,
      name: await this.deps.datasets.datasourceName(rest.datasourceId),
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
      // replay it alongside the user's answer.
      if (previous?.role === 'assistant' && previous.clarification) {
        return [
          { role: 'assistant' as const, content: previous.content },
          { role: 'user' as const, content: latest.content },
        ];
      }
      return latest.content;
    }

    return session.messages.map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, content: message.content }
        : { role: 'assistant' as const, content: message.content },
    );
  }
}
