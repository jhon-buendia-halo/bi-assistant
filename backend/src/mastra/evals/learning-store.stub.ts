/**
 * An in-memory `LearningStore` for the memory eval's unit tests (agents.md
 * 8.3, *Memory arms*): it keeps each scope's signals, lists each as a
 * `signal` and an `index` item as BA-81's store does, writes a summary on
 * `settle`, recalls every signal unless told otherwise, and reports one
 * usage event per embedding and per summary rewrite. No model, no file. Not
 * built (`*.stub.ts`).
 */
import type {
  LearningSignal,
  LearningStore,
  LearningStoreItem,
  MemoryModelUsage,
  RecalledSignal,
} from '../../modules/memory/learning-store.port';

export class StubLearningStore implements LearningStore {
  /** Each port call, in order, as `<method> <scope>`. */
  readonly calls: string[] = [];
  readonly signals = new Map<string, LearningSignal[]>();
  readonly summaries = new Map<string, string>();
  private readonly listeners = new Set<(usage: MemoryModelUsage) => void>();

  /** What `recall` answers; every stored signal of the scope when unset. */
  recallWith?: (
    scope: string,
    question: string,
  ) => RecalledSignal[] | Promise<RecalledSignal[]>;
  /** Thrown by the next `retain`, `settle`, `items` or `forget`. */
  failRetain?: Error;
  failSettle?: Error;
  failItems?: Error;
  failForget?: Error;

  retain(scope: string, signals: LearningSignal[]): Promise<void> {
    this.calls.push(`retain ${scope}`);
    if (this.failRetain) return Promise.reject(this.failRetain);
    const kept = (this.signals.get(scope) ?? []).filter(
      (old) => !signals.some((signal) => signal.documentId === old.documentId),
    );
    this.signals.set(scope, [...kept, ...signals]);
    for (const signal of signals) {
      this.emit(scope, 'embedding', 'text-embedding-3-small', {
        inputTokens: signal.content.length,
        outputTokens: 0,
      });
    }
    return Promise.resolve();
  }

  async recall(scope: string, question: string): Promise<RecalledSignal[]> {
    this.calls.push(`recall ${scope}`);
    this.emit(scope, 'embedding', 'text-embedding-3-small', {
      inputTokens: question.length,
      outputTokens: 0,
    });
    if (this.recallWith) return this.recallWith(scope, question);
    return (this.signals.get(scope) ?? []).map((signal) => ({
      documentId: signal.documentId,
      kind: signal.kind,
      content: signal.content,
      occurredAt: signal.occurredAt,
    }));
  }

  mentalModels(scope: string): Promise<string | null> {
    this.calls.push(`mentalModels ${scope}`);
    return Promise.resolve(this.summaries.get(scope) ?? null);
  }

  forget(scope: string): Promise<void> {
    this.calls.push(`forget ${scope}`);
    if (this.failForget) return Promise.reject(this.failForget);
    this.signals.delete(scope);
    this.summaries.delete(scope);
    return Promise.resolve();
  }

  items(scope: string): Promise<LearningStoreItem[]> {
    this.calls.push(`items ${scope}`);
    if (this.failItems) return Promise.reject(this.failItems);
    const signals = this.signals.get(scope) ?? [];
    const summary = this.summaries.get(scope);
    return Promise.resolve([
      ...signals.map((signal) => ({
        kind: 'signal' as const,
        documentId: signal.documentId,
        text: signal.content,
      })),
      ...signals.map((signal) => ({
        kind: 'index' as const,
        documentId: signal.documentId,
        text: signal.content,
      })),
      ...(summary ? [{ kind: 'summary' as const, text: summary }] : []),
    ]);
  }

  /** Writes the scope's summary, as BA-81's debounced rewrite would. */
  settle(scope: string): Promise<void> {
    this.calls.push(`settle ${scope}`);
    if (this.failSettle) return Promise.reject(this.failSettle);
    const signals = this.signals.get(scope) ?? [];
    if (signals.length) {
      this.summaries.set(
        scope,
        `The analysts left ${signals.length} signal(s) about this data.`,
      );
      this.emit(scope, 'summary', 'gpt-4o-mini', {
        inputTokens: 500,
        outputTokens: 40,
        cachedInputTokens: 100,
      });
    }
    return Promise.resolve();
  }

  onUsage(listener: (usage: MemoryModelUsage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** How many usage listeners are subscribed. */
  get listening(): number {
    return this.listeners.size;
  }

  /** Report a model call of another scope, as another attempt's would. */
  emit(
    scope: string,
    purpose: MemoryModelUsage['purpose'],
    model: string,
    tokens: Pick<
      MemoryModelUsage,
      'inputTokens' | 'outputTokens' | 'cachedInputTokens'
    >,
  ): void {
    for (const listener of this.listeners) {
      listener({ scope, purpose, model, ...tokens });
    }
  }
}
