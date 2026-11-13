import { AGENT_TURN_STEPS } from '../../mastra/workflows/agent-turn.steps';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { runErrorMessage } from '../../mastra/workflows/workflow-run';
import {
  SessionsService,
  type StreamEvent,
} from '../sessions/sessions.service';
import {
  NODE_CHAT_HISTORY_LIMIT,
  nodeChatContextBlock,
  type NodeChatMessage,
} from './node-chat-context';
import { WorkflowNodeChatsRepository } from './repositories/workflow-node-chats.repository';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import {
  RunStepTracker,
  noteToolFrame,
  runAnswerOf,
  type WorkflowRunDoc,
  type WorkflowRunStep,
} from './workflow-run-steps';
import { WorkflowsService, type WorkflowDefinition } from './workflows.service';

/** One event of a node chat stream (api.md 137). */
export type NodeChatStreamEvent =
  | StreamEvent
  | { type: 'done'; message: NodeChatMessage }
  | { type: 'error'; content: string };

/** The agent-turn events a node chat stream passes on (api.md 3.1). */
const TURN_EVENTS = new Set([
  'reasoning',
  'text',
  'tool',
  'tool-result',
  'tool-progress',
]);

/** A node chat turn whose request passed every check (api.md 137). */
export interface PreparedNodeChat {
  run: WorkflowRunDoc;
  workflow: WorkflowDefinition;
  step: WorkflowRunStep;
  /** The user message, trimmed. */
  content: string;
}

/** The run host of a step's node chat: `run-<run id>-node-<step id>`. */
export function nodeChatHostRunId(runId: string, stepId: string): string {
  return `${runId}-node-${stepId}`;
}

/**
 * Chat with a workflow step's agent about that step's data in one stored run
 * (api.md 136, 137; agents.md 5.16; data-model 3.17). A turn runs on a run
 * host of its own (`run-<run id>-node-<step id>`) through the run's turn
 * path: the step's agent with its own tools over the run's datasets, the
 * chat's earlier messages as the transcript and the context block built
 * from the stored run as a system block. The host, its memory thread and
 * its workspace go when the turn ends. The run itself is never changed.
 */
@Injectable()
export class WorkflowNodeChatsService {
  private readonly logger = new Logger(WorkflowNodeChatsService.name);
  /** The run+step chats with a turn under way: one at a time each. */
  private readonly busy = new Set<string>();

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sessions: SessionsService,
    private readonly runs: WorkflowRunsRepository,
    private readonly chats: WorkflowNodeChatsRepository,
  ) {}

  /** A step's chat in a run (api.md 136): its messages, oldest first. */
  async messages(runId: string, stepId: string): Promise<NodeChatMessage[]> {
    await this.storedRun(runId);
    return (await this.chats.get(runId, stepId))?.messages ?? [];
  }

  /**
   * Check a node chat request before any SSE frame (api.md 137, Style B):
   * 404 `Run "<id>" not found`; 400 `Message is required`; 409 `The run is
   * still running`; 404 `Workflow "<id>" not found` for a run of a workflow
   * the catalogue no longer holds; 400 `Step "<stepId>" has no agent to chat
   * with` for an unknown step or a code step; 400 `Step "<stepId>" did not
   * run in this run` for a step the run skipped or never reached; 409 `A
   * reply about step "<stepId>" is already being written` while a turn of
   * the same chat runs.
   */
  async prepare(
    runId: string,
    stepId: string,
    body: unknown,
  ): Promise<PreparedNodeChat> {
    const run = await this.storedRun(runId);
    const raw =
      body && typeof body === 'object'
        ? (body as { content?: unknown }).content
        : undefined;
    const content = typeof raw === 'string' ? raw.trim() : '';
    if (!content) throw new BadRequestException('Message is required');
    if (run.status === 'running') {
      throw new ConflictException('The run is still running');
    }
    if (run.status === 'suspended') {
      throw new ConflictException('The run is waiting for an answer');
    }
    const workflow = await this.workflows.definition(run.workflowId);
    const defined = workflow.steps.find((step) => step.id === stepId);
    if (!defined || defined.kind !== 'agent' || !defined.agent) {
      throw new BadRequestException(
        `Step "${stepId}" has no agent to chat with`,
      );
    }
    // A step that ran more than once is chatted about as its last attempt.
    const step = run.steps.findLast((candidate) => candidate.id === stepId);
    if (!step || step.status === 'skipped' || step.status === 'running') {
      throw new BadRequestException(`Step "${stepId}" did not run in this run`);
    }
    if (this.busy.has(nodeChatHostRunId(runId, stepId))) {
      throw new ConflictException(
        `A reply about step "${stepId}" is already being written`,
      );
    }
    return { run, workflow, step, content };
  }

  /**
   * Run a prepared node chat turn and report it on `emit` (api.md 137): the
   * agent turn's `reasoning`, `text`, `tool`, `tool-result` and
   * `tool-progress` events, then `done { message }` with the assistant
   * message as stored, or `error { content }` when the turn failed. The user
   * message is stored first; the assistant message (its text, tool calls,
   * and `stopped` or `error`) when the turn ends. A stopped turn
   * (`abortSignal`) sends nothing more and stores what came.
   */
  async stream(
    prepared: PreparedNodeChat,
    emit: (event: NodeChatStreamEvent) => void,
    abortSignal?: AbortSignal,
  ): Promise<NodeChatMessage> {
    const key = nodeChatHostRunId(prepared.run.id, prepared.step.id);
    this.busy.add(key);
    try {
      return await this.turn(prepared, emit, abortSignal);
    } finally {
      this.busy.delete(key);
    }
  }

  private async turn(
    { run, step, content }: PreparedNodeChat,
    emit: (event: NodeChatStreamEvent) => void,
    abortSignal?: AbortSignal,
  ): Promise<NodeChatMessage> {
    const live = (event: NodeChatStreamEvent) => {
      if (!abortSignal?.aborted) emit(event);
    };
    const earlier = (await this.chats.get(run.id, step.id))?.messages ?? [];
    await this.chats.append(run.id, step.id, {
      id: randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    });
    // The turn is the step's agent alone, on the agent-turn engine
    // (agents.md 5.16): its one agent step holds the turn's calls.
    const tracker = new RunStepTracker(
      AGENT_TURN_STEPS.map((entry) => ({
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
      })),
    );
    const transcript = earlier
      .slice(-NODE_CHAT_HISTORY_LIMIT)
      .filter((message) => message.content.trim())
      .map((message) => ({ role: message.role, content: message.content }));
    let text = '';
    let error: string | undefined;
    let hostId: string | undefined;
    try {
      const host = await this.sessions.createRunHost({
        runId: nodeChatHostRunId(run.id, step.id),
        workflowId: run.workflowId,
        name: `${run.workflowName}: ${step.title}`,
        datasets: run.datasets,
        transcript,
        contextBlock: nodeChatContextBlock(run, step.id),
      });
      hostId = host.id;
      await this.sessions.streamRunTurn(
        host.id,
        content,
        (event) => {
          noteToolFrame(tracker, event);
          if (!TURN_EVENTS.has(event.type)) return;
          if (event.type === 'text') text += event.content ?? '';
          live(event);
        },
        abortSignal,
        false,
        (event) => tracker.apply(event),
      );
    } catch (failure) {
      if (!abortSignal?.aborted) error = runErrorMessage(failure);
    }
    const stopped = !!abortSignal?.aborted;
    const answer = hostId ? await this.endHost(hostId, transcript.length) : '';
    // The turn's calls are its agent step's: the engine's one agent step.
    const calls = tracker
      .finish(stopped ? 'stopped' : error ? 'failed' : 'success', error)
      .steps.flatMap((entry) => entry.toolCalls ?? []);
    const message: NodeChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      // The stored answer is the final one (a guard can rewrite the text).
      content: !stopped && !error && answer ? answer : text.trim(),
      ...(calls.length ? { toolCalls: calls } : {}),
      ...(stopped ? { stopped: true as const } : {}),
      ...(error ? { error } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.chats.append(run.id, step.id, message);
    if (error) live({ type: 'error', content: error });
    else live({ type: 'done', message });
    return message;
  }

  /**
   * End a node chat's host: its answer (the last message when it is an
   * assistant message after the turn's own), then the host, its memory
   * thread and its workspace are gone.
   */
  private async endHost(hostId: string, earlier: number): Promise<string> {
    let answer = '';
    try {
      const view = await this.sessions.finishRunHost(hostId);
      answer = runAnswerOf(view.messages, earlier)?.content?.trim() ?? '';
    } catch (failure) {
      this.logger.warn(
        `Could not end the node chat host ${hostId}: ${runErrorMessage(failure)}`,
      );
    }
    try {
      await this.sessions.deleteRunHostResources(hostId);
    } catch (failure) {
      this.logger.warn(
        `Could not delete the workspace of ${hostId}: ${runErrorMessage(failure)}`,
      );
    }
    return answer;
  }

  private async storedRun(runId: string): Promise<WorkflowRunDoc> {
    const run = await this.runs.get(runId);
    if (!run) throw new NotFoundException(`Run "${runId}" not found`);
    return run;
  }
}
