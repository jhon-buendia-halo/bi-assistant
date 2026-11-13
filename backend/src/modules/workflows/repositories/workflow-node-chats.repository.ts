import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  WORKFLOW_RUN_NODE_CHATS_STORE,
  type DocStore,
} from '../../../infrastructure/database/doc-store';
import type { NodeChatMessage } from '../node-chat-context';

/** One node chat as stored: a run's step and its messages, oldest first. */
export interface NodeChatDoc {
  id: string;
  runId: string;
  stepId: string;
  messages: NodeChatMessage[];
  /** Store-maintained. */
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Node chats, collection `workflow_run_node_chats` (data-model 3.17): one
 * document per run and step, created with its first message and deleted
 * with its run (api.md 122).
 */
@Injectable()
export class WorkflowNodeChatsRepository {
  constructor(
    @Inject(WORKFLOW_RUN_NODE_CHATS_STORE)
    private readonly store: DocStore<NodeChatDoc>,
  ) {}

  /** A step's chat in a run, or null when nobody chatted there yet. */
  get(runId: string, stepId: string): Promise<NodeChatDoc | null> {
    return this.store.findOne({ runId, stepId });
  }

  /** Add a message at the end of a step's chat, creating the chat. */
  async append(
    runId: string,
    stepId: string,
    message: NodeChatMessage,
  ): Promise<NodeChatDoc> {
    const chat = await this.get(runId, stepId);
    if (!chat) {
      return this.store.insert({
        id: randomUUID(),
        runId,
        stepId,
        messages: [message],
      });
    }
    const messages = [...chat.messages, message];
    return (
      (await this.store.update({ id: chat.id }, { messages })) ?? {
        ...chat,
        messages,
      }
    );
  }

  /** Delete every node chat of a run (api.md 122). */
  deleteByRun(runId: string): Promise<number> {
    return this.store.deleteMany({ runId });
  }
}
