import type {
  LearningStore,
  MentalModel,
  RecalledMemory,
} from './learning-store.port';

/**
 * The store when `HINDSIGHT_URL` is unset: disabled, so callers skip every
 * memory step and a turn costs exactly what it did before the memory existed.
 */
export class NoopLearningStore implements LearningStore {
  readonly enabled = false;

  retain(): Promise<void> {
    return Promise.resolve();
  }

  recall(): Promise<RecalledMemory[]> {
    return Promise.resolve([]);
  }

  mentalModels(): Promise<MentalModel[]> {
    return Promise.resolve([]);
  }

  forget(): Promise<void> {
    return Promise.resolve();
  }
}
