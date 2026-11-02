import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { MastraDBMessage } from '@mastra/core/memory';
import {
  type MastraCompositeStore,
  type MemoryStorage,
  TABLE_MESSAGES,
  TABLE_RESOURCES,
  TABLE_THREADS,
} from '@mastra/core/storage';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import type { LibSQLVector, SqliteClient } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import type { LearningStoreMaintenance } from './learning-store-maintenance';
import type {
  LearningSignal,
  LearningSignalKind,
  LearningStore,
  LearningStoreItem,
  MemoryModelUsage,
  RecalledSignal,
} from './learning-store.port';
import {
  type EmbedArgs,
  type EmbeddingModelLike,
  NO_EMBEDDING_KEY_MESSAGE,
  type SummaryModel,
  modelName,
} from './models';
import { clip } from './signal-text';
import { SUMMARY_CHARS, SUMMARY_INSTRUCTIONS, summaryPrompt } from './summary';

/** A learning thread's id: `learning-<scope>` (data-model 5.2). */
export const learningThreadOf = (scope: string) => `learning-${scope}`;
const THREAD_PREFIX = 'learning-';
/** The scopes of the memory eval (BA-190): removed at every start. */
const EVAL_SCOPE_PREFIX = 'eval-';

/**
 * The relevance filter (knowledge R36, agents.md 2.1): at most 4 messages at
 * least 0.4 similar to the question, no neighbours, the thread alone (a
 * resource-scoped recall reads a resource's store from any thread id).
 */
export const SEMANTIC_RECALL = {
  scope: 'thread' as const,
  topK: 4,
  messageRange: 0,
  threshold: 0.4,
};
/** A recall slower than this is nothing (knowledge R36). */
export const RECALL_TIMEOUT_MS = 2_500;
/**
 * Quiet period after the last retain or forget of a scope before its
 * summary is rewritten.
 */
export const SUMMARY_DELAY_MS = 5_000;
/** The framework names its message indexes `memory_messages[_<dimension>]`. */
const MESSAGE_INDEX_PREFIX = 'memory_messages';
/** Tries of one statement that met a locked file (another client of it). */
const BUSY_TRIES = 6;
const BUSY_BACKOFF_MS = 100;

/** The framework's storage and vector store the memory runs on. */
export interface LearningStoreBackend {
  storage: MastraCompositeStore;
  vector: LibSQLVector;
}

export interface MastraLearningStoreOptions {
  /** Called once, on the first operation that needs the framework's memory. */
  backend: () => LearningStoreBackend;
  /** Called once, on the first raw statement (audit, compaction, clean-up). */
  client: () => Promise<SqliteClient>;
  embedder: EmbeddingModelLike;
  /** Whether an embedding key exists now; without one nothing is stored. */
  hasEmbeddingKey: () => Promise<boolean>;
  summaryModel: SummaryModel;
  summaryDelayMs?: number;
  recallTimeoutMs?: number;
}

interface Opened {
  memory: Memory;
  store: MemoryStorage;
  vector: LibSQLVector;
}

/**
 * "Mastra only" (agents.md 2.1, data-model 5.2): one learning thread per
 * scope in `mastra.sqlite`, one message per signal (its id the signal's
 * document id), the framework's semantic recall over that thread, and the
 * summary kept as the scope's resource working memory.
 *
 * Nothing is opened until an operation needs it, so with the lever off (no
 * retain, no recall) no `Memory` is ever built. Writes of one scope run one
 * at a time; a summary rewrite is dropped when a retain or forget of its
 * scope happened while the model wrote it (that one schedules another).
 */
export class MastraLearningStore
  implements LearningStore, LearningStoreMaintenance
{
  private readonly logger = new Logger(MastraLearningStore.name);
  private opened?: Promise<Opened>;
  private raw?: Promise<SqliteClient>;
  private readonly listeners = new Set<(usage: MemoryModelUsage) => void>();
  /** The scope of the operation an embedding call belongs to. */
  private readonly scopeContext = new AsyncLocalStorage<string>();
  private readonly locks = new Map<string, Promise<void>>();
  /** Bumped by every retain and forget of a scope. */
  private readonly versions = new Map<string, number>();
  private readonly summaryTimers = new Map<string, NodeJS.Timeout>();
  private readonly summaryRuns = new Map<string, Promise<void>>();
  private readonly summaryDelayMs: number;
  private readonly recallTimeoutMs: number;

  constructor(private readonly options: MastraLearningStoreOptions) {
    this.summaryDelayMs = options.summaryDelayMs ?? SUMMARY_DELAY_MS;
    this.recallTimeoutMs = options.recallTimeoutMs ?? RECALL_TIMEOUT_MS;
  }

  // ------------------------------------------------------------ the port

  async retain(scope: string, signals: LearningSignal[]): Promise<void> {
    if (!signals.length) return;
    if (!(await this.options.hasEmbeddingKey())) {
      throw new Error(NO_EMBEDDING_KEY_MESSAGE);
    }
    const moved = await this.withLock(scope, () =>
      this.inScope(scope, () => this.store(scope, signals)),
    );
    this.scheduleSummary(scope);
    for (const other of moved) this.scheduleSummary(other);
  }

  async recall(scope: string, question: string): Promise<RecalledSignal[]> {
    const asked = question.trim();
    if (!asked) return [];
    const work = this.recallNow(scope, asked).catch((error: unknown) => {
      this.logger.warn(
        `Memory recall for ${scope} failed: ${errorText(error)}`,
      );
      return [];
    });
    let timer: NodeJS.Timeout | undefined;
    const cutOff = new Promise<RecalledSignal[]>((resolve) => {
      timer = setTimeout(() => resolve([]), this.recallTimeoutMs);
    });
    try {
      return await Promise.race([work, cutOff]);
    } finally {
      clearTimeout(timer);
    }
  }

  async mentalModels(scope: string): Promise<string | null> {
    try {
      const { store } = await this.open();
      const resource = await store.getResourceById({ resourceId: scope });
      const text = resource?.workingMemory?.trim();
      if (!text || resource?.metadata?.summaryStaleSince) return null;
      return text;
    } catch (error) {
      this.logger.warn(
        `Memory summary of ${scope} unreadable: ${errorText(error)}`,
      );
      return null;
    }
  }

  async forget(scope: string, documentId?: string): Promise<void> {
    try {
      const held = await this.withLock(scope, () =>
        this.inScope(scope, () =>
          documentId
            ? this.forgetOne(scope, documentId)
            : this.forgetAll(scope),
        ),
      );
      if (held) this.scheduleSummary(scope);
    } catch (error) {
      this.logger.warn(
        `Memory forget of ${documentId ?? 'everything'} in ${scope} failed: ${errorText(error)}`,
      );
    }
  }

  async items(scope: string): Promise<LearningStoreItem[]> {
    const { store, vector } = await this.open();
    const threadId = learningThreadOf(scope);
    const items: LearningStoreItem[] = [];
    if (await store.getThreadById({ threadId })) {
      const { messages } = await store.listMessages({
        threadId,
        perPage: false,
      });
      for (const message of messages) {
        items.push({
          kind: 'signal',
          documentId: message.id,
          text: messageText(message),
        });
      }
    }
    for (const index of await this.messageIndexes(vector)) {
      const rows = await this.execute(
        `SELECT metadata FROM "${index}" WHERE json_extract(metadata, '$.thread_id') = ?`,
        [threadId],
      );
      for (const row of rows) {
        const metadata = parseJson(row.metadata);
        items.push({
          kind: 'index',
          ...(typeof metadata.message_id === 'string'
            ? { documentId: metadata.message_id }
            : {}),
          text: typeof metadata.content === 'string' ? metadata.content : '',
        });
      }
    }
    const resource = await store.getResourceById({ resourceId: scope });
    if (resource?.workingMemory?.trim()) {
      items.push({ kind: 'summary', text: resource.workingMemory });
    }
    return items;
  }

  async settle(scope: string): Promise<void> {
    for (let pass = 0; pass < 50; pass++) {
      const lock = this.locks.get(scope);
      if (lock) await lock;
      const timer = this.summaryTimers.get(scope);
      if (timer) {
        clearTimeout(timer);
        this.summaryTimers.delete(scope);
        void this.runSummary(scope);
      }
      const run = this.summaryRuns.get(scope);
      if (run) await run;
      if (
        this.locks.get(scope) === lock &&
        !this.summaryTimers.has(scope) &&
        this.summaryRuns.get(scope) === run
      ) {
        break;
      }
    }
    if (this.opened) await (await this.opened).memory.settled();
  }

  onUsage(listener: (usage: MemoryModelUsage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * At shutdown: run the summary rewrites still waiting, let the running
   * ones and the framework's background deletes finish.
   */
  async close(): Promise<void> {
    const scopes = new Set([
      ...this.summaryTimers.keys(),
      ...this.summaryRuns.keys(),
    ]);
    await Promise.all([...scopes].map((scope) => this.settle(scope)));
    if (this.opened)
      await (await this.opened.catch(() => undefined))?.memory.settled();
  }

  // ------------------------------------------------------- maintenance

  async compact(): Promise<void> {
    const checkpoint = async () => {
      const [row] = await this.execute('PRAGMA wal_checkpoint(TRUNCATE)');
      // `busy` = 1: a reader still holds frames, so the log was not emptied.
      if (row && Number(row.busy) !== 0) {
        throw new Error(
          'mastra.sqlite is busy; the write-ahead log was not emptied',
        );
      }
    };
    await this.retryBusy(checkpoint);
    await this.execute('VACUUM');
    await this.retryBusy(checkpoint);
  }

  async scopesHolding(documentId: string): Promise<string[]> {
    const rows = await this.executeIfTable(
      TABLE_MESSAGES,
      `SELECT thread_id FROM ${TABLE_MESSAGES} WHERE id = ?`,
      [documentId],
    );
    return rows
      .map((row) => (typeof row.thread_id === 'string' ? row.thread_id : ''))
      .filter((thread) => thread.startsWith(THREAD_PREFIX))
      .map((thread) => thread.slice(THREAD_PREFIX.length));
  }

  async holdsScope(scope: string): Promise<boolean> {
    const threads = await this.executeIfTable(
      TABLE_THREADS,
      `SELECT 1 FROM ${TABLE_THREADS} WHERE id = ?`,
      [learningThreadOf(scope)],
    );
    if (threads.length) return true;
    const resources = await this.executeIfTable(
      TABLE_RESOURCES,
      `SELECT 1 FROM ${TABLE_RESOURCES} WHERE id = ?`,
      [scope],
    );
    return resources.length > 0;
  }

  async removeEvalScopes(): Promise<number> {
    const threads = await this.executeIfTable(
      TABLE_THREADS,
      `SELECT id FROM ${TABLE_THREADS} WHERE id LIKE ?`,
      [`${THREAD_PREFIX}${EVAL_SCOPE_PREFIX}%`],
    );
    const resources = await this.executeIfTable(
      TABLE_RESOURCES,
      `SELECT id FROM ${TABLE_RESOURCES} WHERE id LIKE ?`,
      [`${EVAL_SCOPE_PREFIX}%`],
    );
    const scopes = new Set([
      ...threads.map((row) => String(row.id).slice(THREAD_PREFIX.length)),
      ...resources.map((row) => String(row.id)),
    ]);
    for (const scope of scopes) await this.forget(scope);
    return scopes.size;
  }

  // ----------------------------------------------------------- retain

  /**
   * Store signals in the scope's thread; returns the other scopes a moved
   * signal left.
   */
  private async store(
    scope: string,
    signals: LearningSignal[],
  ): Promise<string[]> {
    const { memory, store } = await this.open();
    const threadId = learningThreadOf(scope);
    if (!(await memory.getThreadById({ threadId }))) {
      const now = new Date();
      await memory.saveThread({
        // No metadata: the framework copies a thread's metadata into every
        // vector it stores for the thread.
        thread: {
          id: threadId,
          resourceId: scope,
          title: threadId,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    // The last signal of a document id wins.
    const latest = new Map(
      signals.map((signal) => [signal.documentId, signal]),
    );
    const { messages: existing } = await store.listMessagesById({
      messageIds: [...latest.keys()],
    });
    const here = new Set(
      existing.filter((m) => m.threadId === threadId).map((m) => m.id),
    );
    // A signal stored in another learning memory (the session's datasource
    // changed) moves here.
    const elsewhere = existing.filter((m) => m.threadId !== threadId);
    if (elsewhere.length) {
      await memory.deleteMessages(elsewhere.map((m) => m.id));
      await memory.settled();
    }
    const fresh = [...latest.values()].filter((s) => !here.has(s.documentId));
    const stored = [...latest.values()].filter((s) => here.has(s.documentId));
    this.bump(scope);
    if (fresh.length) {
      const times = await this.freeTimes(store, threadId, fresh);
      try {
        await memory.saveMessages({
          messages: fresh.map((signal, i) =>
            toMessage(signal, scope, times[i]),
          ),
        });
      } catch (error) {
        // The framework saves the message before it embeds it: a message
        // left without its embedding could never be recalled.
        await memory
          .deleteMessages(fresh.map((signal) => signal.documentId))
          .catch(() => undefined);
        await memory.settled();
        throw error;
      }
    }
    if (stored.length) {
      // `updateMessages` replaces the embedding; a second `saveMessages`
      // would add one more each time and leave the old text searchable.
      await memory.updateMessages({
        messages: stored.map((signal) => toUpdate(signal, scope)),
      });
    }
    return elsewhere
      .map((m) => m.threadId ?? '')
      .filter((thread) => thread.startsWith(THREAD_PREFIX))
      .map((thread) => thread.slice(THREAD_PREFIX.length));
  }

  /**
   * Each new message's time: its signal's, moved forward by the fewest
   * milliseconds that make it unique in the thread. The framework's recall
   * fetches a hit as "the latest message at or before the hit's time, the
   * greatest id first" (@mastra/libsql 1.22.5), so two messages at one time
   * would hand back the wrong one.
   */
  private async freeTimes(
    store: MemoryStorage,
    threadId: string,
    signals: LearningSignal[],
  ): Promise<Date[]> {
    const { messages } = await store.listMessages({ threadId, perPage: false });
    const taken = new Set(messages.map((m) => time(m.createdAt)));
    return signals.map((signal) => {
      let at = Date.parse(signal.occurredAt);
      if (Number.isNaN(at)) at = Date.now();
      while (taken.has(at)) at += 1;
      taken.add(at);
      return new Date(at);
    });
  }

  // ----------------------------------------------------------- recall

  private async recallNow(
    scope: string,
    question: string,
  ): Promise<RecalledSignal[]> {
    if (!(await this.options.hasEmbeddingKey())) return [];
    return this.inScope(scope, async () => {
      const { memory } = await this.open();
      const threadId = learningThreadOf(scope);
      if (!(await memory.getThreadById({ threadId }))) return [];
      const { messages } = await memory.recall({
        threadId,
        resourceId: scope,
        vectorSearchString: question,
      });
      return newestOfEachText(
        messages.map(toRecalled).filter((s): s is RecalledSignal => !!s),
      );
    });
  }

  // ----------------------------------------------------------- forget

  /** Forget one signal; true when the scope held it. */
  private async forgetOne(scope: string, documentId: string): Promise<boolean> {
    const { memory, store, vector } = await this.open();
    const threadId = learningThreadOf(scope);
    this.bump(scope);
    const { messages } = await store.listMessagesById({
      messageIds: [documentId],
    });
    const held = messages.some((m) => m.threadId === threadId);
    if (held) await memory.deleteMessages([documentId]);
    // The framework deletes the vector, with its copy of the text, in a
    // background step.
    await memory.settled();
    await this.deleteVectors(vector, {
      message_id: documentId,
      thread_id: threadId,
    });
    if (held) {
      // Not sent until it is rewritten without the signal (knowledge R42).
      await store.updateResource({
        resourceId: scope,
        workingMemory: '',
        metadata: { summaryStaleSince: new Date().toISOString() },
      });
    }
    return held;
  }

  private async forgetAll(scope: string): Promise<false> {
    const { memory, vector } = await this.open();
    const threadId = learningThreadOf(scope);
    this.bump(scope);
    this.cancelSummary(scope);
    await memory.deleteThread(threadId);
    await memory.settled();
    await this.deleteVectors(vector, { thread_id: threadId });
    await this.executeIfTable(
      TABLE_RESOURCES,
      `DELETE FROM ${TABLE_RESOURCES} WHERE id = ?`,
      [scope],
    );
    return false;
  }

  /** What the framework's background delete should have left: nothing. */
  private async deleteVectors(
    vector: LibSQLVector,
    filter: Record<string, string>,
  ): Promise<void> {
    for (const indexName of await this.messageIndexes(vector)) {
      await this.retryBusy(() => vector.deleteVectors({ indexName, filter }));
    }
  }

  // ---------------------------------------------------------- summary

  private scheduleSummary(scope: string): void {
    const pending = this.summaryTimers.get(scope);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.summaryTimers.delete(scope);
      void this.runSummary(scope);
    }, this.summaryDelayMs);
    timer.unref();
    this.summaryTimers.set(scope, timer);
  }

  private cancelSummary(scope: string): void {
    const pending = this.summaryTimers.get(scope);
    if (pending) clearTimeout(pending);
    this.summaryTimers.delete(scope);
  }

  private runSummary(scope: string): Promise<void> {
    const previous = this.summaryRuns.get(scope) ?? Promise.resolve();
    const run: Promise<void> = previous
      .then(() => this.inScope(scope, () => this.rewriteSummary(scope)))
      .catch((error: unknown) => {
        this.logger.warn(
          `Memory summary of ${scope} not rewritten: ${errorText(error)}`,
        );
      })
      .finally(() => {
        if (this.summaryRuns.get(scope) === run) this.summaryRuns.delete(scope);
      });
    this.summaryRuns.set(scope, run);
    return run;
  }

  /** One call of the configured model over the stored signals, oldest first. */
  private async rewriteSummary(scope: string): Promise<void> {
    const version = this.versions.get(scope) ?? 0;
    const { store } = await this.open();
    const threadId = learningThreadOf(scope);
    const thread = await store.getThreadById({ threadId });
    const messages = thread
      ? (await store.listMessages({ threadId, perPage: false })).messages
      : [];
    const signals = [...messages]
      .sort((a, b) => time(a.createdAt) - time(b.createdAt))
      .map(messageText)
      .filter(Boolean);
    let text = '';
    if (signals.length) {
      const result = await this.options.summaryModel.generate(
        SUMMARY_INSTRUCTIONS,
        summaryPrompt(signals),
      );
      this.emit({
        scope,
        purpose: 'summary',
        model: modelName(result.model),
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        ...(result.usage?.cachedInputTokens !== undefined
          ? { cachedInputTokens: result.usage.cachedInputTokens }
          : {}),
        ...(result.usage?.reasoningTokens !== undefined
          ? { reasoningTokens: result.usage.reasoningTokens }
          : {}),
      });
      text = clip(result.text.trim(), SUMMARY_CHARS);
    }
    await this.withLock(scope, async () => {
      // A retain or forget meanwhile scheduled another rewrite.
      if ((this.versions.get(scope) ?? 0) !== version) return;
      if (!thread && !(await store.getResourceById({ resourceId: scope })))
        return;
      await store.updateResource({
        resourceId: scope,
        workingMemory: text,
        metadata: {
          summaryWrittenAt: new Date().toISOString(),
          summaryStaleSince: null,
        },
      });
    });
  }

  // ---------------------------------------------------------- plumbing

  private open(): Promise<Opened> {
    if (!this.opened) {
      this.opened = (async () => {
        const { storage, vector } = this.options.backend();
        const memory = new Memory({
          storage,
          vector,
          embedder:
            this.countingEmbedder() as unknown as MastraEmbeddingModel<string>,
          options: {
            lastMessages: false,
            semanticRecall: SEMANTIC_RECALL,
            generateTitle: false,
          },
        });
        // Through the memory's own view of the storage, which runs the
        // storage's (cached) initialisation first.
        const store = await memory.storage.getStore('memory');
        if (!store)
          throw new Error('The memory storage domain is not available');
        return { memory, store, vector };
      })();
      this.opened.catch(() => {
        this.opened = undefined;
      });
    }
    return this.opened;
  }

  /** The embedder, reporting each call it makes under the operation's scope. */
  private countingEmbedder(): EmbeddingModelLike {
    const inner = this.options.embedder;
    return {
      specificationVersion: inner.specificationVersion,
      provider: inner.provider,
      modelId: inner.modelId,
      maxEmbeddingsPerCall: inner.maxEmbeddingsPerCall,
      supportsParallelCalls: inner.supportsParallelCalls,
      doEmbed: async (args: EmbedArgs) => {
        const result = await inner.doEmbed(args);
        this.emit({
          scope: this.scopeContext.getStore() ?? '',
          purpose: 'embedding',
          model: modelName(inner.modelId),
          inputTokens: result.usage?.tokens ?? 0,
          outputTokens: 0,
        });
        return result;
      },
    };
  }

  private emit(usage: MemoryModelUsage): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(usage);
      } catch (error) {
        this.logger.warn(`A memory usage listener failed: ${errorText(error)}`);
      }
    }
  }

  private inScope<T>(scope: string, work: () => Promise<T>): Promise<T> {
    return this.scopeContext.run(scope, work);
  }

  private bump(scope: string): void {
    this.versions.set(scope, (this.versions.get(scope) ?? 0) + 1);
  }

  /** Writes of one scope, one at a time. */
  private withLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(scope) ?? Promise.resolve();
    const next = previous.then(work);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(scope, tail);
    void tail.then(() => {
      if (this.locks.get(scope) === tail) this.locks.delete(scope);
    });
    return next;
  }

  private async messageIndexes(vector: LibSQLVector): Promise<string[]> {
    return (await vector.listIndexes()).filter((name) =>
      name.startsWith(MESSAGE_INDEX_PREFIX),
    );
  }

  private client(): Promise<SqliteClient> {
    if (!this.raw) {
      this.raw = this.options.client();
      this.raw.catch(() => {
        this.raw = undefined;
      });
    }
    return this.raw;
  }

  private async execute(
    sql: string,
    args: (string | number | null)[] = [],
  ): Promise<Record<string, unknown>[]> {
    const client = await this.client();
    return this.retryBusy(
      async () => (await client.execute({ sql, args })).rows,
    );
  }

  /** `execute`, or nothing when the table does not exist yet (a fresh file). */
  private async executeIfTable(
    table: string,
    sql: string,
    args: (string | number | null)[] = [],
  ): Promise<Record<string, unknown>[]> {
    const exists = await this.execute(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    return exists.length ? this.execute(sql, args) : [];
  }

  /** Retry a statement that met a lock held by another client of the file. */
  private async retryBusy<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (attempt >= BUSY_TRIES || !isBusy(error)) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, BUSY_BACKOFF_MS * 2 ** (attempt - 1)),
        );
      }
    }
  }
}

/** One message per signal (data-model 5.2). */
function toMessage(
  signal: LearningSignal,
  scope: string,
  createdAt: Date,
): MastraDBMessage {
  return {
    id: signal.documentId,
    role: 'user',
    createdAt,
    threadId: learningThreadOf(scope),
    resourceId: scope,
    content: signalContent(signal),
  };
}

function toUpdate(signal: LearningSignal, scope: string) {
  return {
    id: signal.documentId,
    threadId: learningThreadOf(scope),
    resourceId: scope,
    content: signalContent(signal),
  };
}

function signalContent(signal: LearningSignal): MastraDBMessage['content'] {
  return {
    format: 2,
    parts: [{ type: 'text', text: signal.content }],
    content: signal.content,
    metadata: {
      documentId: signal.documentId,
      kind: signal.kind,
      datasourceId: signal.metadata.datasourceId,
      datasetIds: signal.metadata.datasetIds,
      entities: signal.metadata.entities,
    },
  };
}

const SIGNAL_KINDS: LearningSignalKind[] = [
  'verified_query',
  'correction',
  'rejection',
];

function toRecalled(message: MastraDBMessage): RecalledSignal | undefined {
  const text = messageText(message);
  if (!text) return undefined;
  const stored = message.content?.metadata?.kind;
  const fromText = /^\[(\w+) ·/.exec(text)?.[1];
  const kind = [stored, fromText].find((k): k is LearningSignalKind =>
    SIGNAL_KINDS.includes(k as LearningSignalKind),
  );
  if (!kind) return undefined;
  return {
    documentId: message.id,
    kind,
    content: text,
    occurredAt: new Date(time(message.createdAt)).toISOString(),
  };
}

/** Oldest first; a text found twice kept once, the newest. */
function newestOfEachText(signals: RecalledSignal[]): RecalledSignal[] {
  const byText = new Map<string, RecalledSignal>();
  for (const signal of signals) {
    const kept = byText.get(signal.content);
    if (!kept || kept.occurredAt <= signal.occurredAt)
      byText.set(signal.content, signal);
  }
  return [...byText.values()].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  );
}

function messageText(message: MastraDBMessage): string {
  const content = message.content;
  if (typeof content?.content === 'string' && content.content)
    return content.content;
  return (content?.parts ?? [])
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
    .trim();
}

function time(value: Date | string | undefined): number {
  return value instanceof Date ? value.getTime() : Date.parse(String(value));
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = errorText(error).toLowerCase();
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    message.includes('database is locked') ||
    message.includes('busy')
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
