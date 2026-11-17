import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ChatMessage } from '../../sessions/models/session.model';
import { WorkflowRun } from '../models/workflow.model';
import { WorkflowDesigner } from './workflow-designer.service';
import { WorkflowRunsApiService } from './workflow-runs-api.service';

/** One earlier question of the conversation and its answer (workflows R38). */
export interface ConversationTurn {
  runId: string;
  question: string;
  /** Absent when that run stopped or failed before answering. */
  answer?: ChatMessage;
  status: WorkflowRun['status'];
  run: WorkflowRun;
}

/** How far back a conversation is followed. */
export const MAX_EARLIER_TURNS = 20;

/** The question a stored run was asked, as its turn reads. */
export function turnQuestion(run: WorkflowRun): string {
  const question = run.question ?? run.input['question'];
  return typeof question === 'string' && question.trim() !== ''
    ? question
    : run.workflowName;
}

/**
 * The Business view's conversation (workflows R38): every follow-up is a run
 * of its own that names the run it follows up on (`context.fromRunId`). From
 * the shown run, this walks those links back and keeps the earlier runs,
 * oldest first, so the view reads as one thread. Stored runs are read once
 * (`GET /workflow-runs/:id`) and cached. Off until a Business view turns it on.
 */
@Injectable()
export class WorkflowConversation {
  private readonly designer = inject(WorkflowDesigner);
  private readonly api = inject(WorkflowRunsApiService);
  private readonly cache = new Map<string, WorkflowRun>();
  private generation = 0;
  private lastFrom: string | null | undefined = undefined;

  /** Turn on for the Business view; off, the conversation stays empty. */
  readonly active = signal(false);
  /** The earlier turns, oldest first; the shown run is not one of them. */
  readonly earlier = signal<ConversationTurn[]>([]);

  constructor() {
    effect(() => {
      const from = this.active()
        ? (this.designer.contextRun()?.id ??
          this.designer.run()?.context?.fromRunId ??
          null)
        : null;
      untracked(() => this.follow(from));
    });
  }

  private follow(from: string | null): void {
    if (from === this.lastFrom) return;
    this.lastFrom = from;
    const generation = ++this.generation;
    if (from === null) {
      this.earlier.set([]);
      return;
    }
    const chain: WorkflowRun[] = [];
    const done = () => {
      if (generation !== this.generation) return;
      this.earlier.set(
        chain.reverse().map((run) => ({
          runId: run.id,
          question: turnQuestion(run),
          answer: run.answer,
          status: run.status,
          run,
        })),
      );
    };
    const step = (id: string | null): void => {
      if (
        id === null ||
        chain.length >= MAX_EARLIER_TURNS ||
        chain.some((run) => run.id === id)
      ) {
        done();
        return;
      }
      const add = (run: WorkflowRun) => {
        this.cache.set(run.id, run);
        chain.push(run);
        step(run.context?.fromRunId ?? null);
      };
      const cached = this.cache.get(id);
      if (cached !== undefined) {
        add(cached);
        return;
      }
      // A deleted earlier run ends the thread there.
      this.api.getRun(id).subscribe({ next: add, error: () => done() });
    };
    step(from);
  }
}
