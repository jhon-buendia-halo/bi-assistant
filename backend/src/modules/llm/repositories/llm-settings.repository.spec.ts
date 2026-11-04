import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import { SqliteTransactions } from '../../../infrastructure/database/sqlite-transactions';
import { LlmSettingsRepository } from './llm-settings.repository';
import type { LlmSettingsDoc } from '../llm.types';

/** Real `SqliteDocStore` over an in-memory database, as the other repos test. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<LlmSettingsDoc>(db, 'settings');
  const repository = new LlmSettingsRepository(
    store,
    new SqliteTransactions(db),
  );
  return { repository, store, db };
}

const keyedCustom: Omit<LlmSettingsDoc, 'key'> = {
  provider: 'custom',
  model: 'llama3',
  baseUrl: 'http://127.0.0.1:8317/v1',
  apiKeyCiphertext: 'iv:tag:data',
  apiStyle: 'openai',
  reasoningEffort: 'low',
};

describe('LlmSettingsRepository', () => {
  let db: BetterSqlite3.Database;
  let repository: LlmSettingsRepository;
  let store: SqliteDocStore<LlmSettingsDoc>;

  beforeEach(() => {
    ({ repository, store, db } = build());
  });

  afterEach(() => db.close());

  it('save stores the doc under the single key', async () => {
    await repository.save(keyedCustom);

    await expect(repository.get()).resolves.toMatchObject({
      key: 'llm',
      ...keyedCustom,
    });
  });

  it('save replaces: a keyless save drops the stored key', async () => {
    await repository.save(keyedCustom);
    await repository.save({
      provider: 'custom',
      model: 'qwen',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiStyle: 'openai',
    });

    const stored = await repository.get();
    expect(stored).not.toHaveProperty('apiKeyCiphertext');
    expect(stored).toMatchObject({ model: 'qwen', apiStyle: 'openai' });
  });

  it('save replaces: another provider drops the API style', async () => {
    await repository.save(keyedCustom);
    await repository.save({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: '',
      apiKeyCiphertext: 'iv:tag:other',
    });

    const stored = await repository.get();
    expect(stored).not.toHaveProperty('apiStyle');
    expect(stored).toMatchObject({
      provider: 'openai',
      apiKeyCiphertext: 'iv:tag:other',
    });
  });

  it('save is all or nothing', async () => {
    await repository.save(keyedCustom);
    jest.spyOn(store, 'unset').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      repository.save({
        provider: 'custom',
        model: 'qwen',
        baseUrl: 'http://evil.local/v1',
        apiStyle: 'openai',
      }),
    ).rejects.toThrow('disk full');

    await expect(repository.get()).resolves.toMatchObject(keyedCustom);
  });

  it('unset removes the named fields and leaves the rest', async () => {
    await repository.save(keyedCustom);

    await repository.unset('apiKeyCiphertext', 'apiStyle');

    const stored = await repository.get();
    expect(stored).not.toHaveProperty('apiKeyCiphertext');
    expect(stored).not.toHaveProperty('apiStyle');
    expect(stored).toMatchObject({
      provider: 'custom',
      model: 'llama3',
      reasoningEffort: 'low',
    });
  });

  it('unset and patch answer null when nothing is stored', async () => {
    await expect(repository.unset('apiStyle')).resolves.toBeNull();
    await expect(
      repository.patch({ reasoningEffort: 'low' }),
    ).resolves.toBeNull();
  });
});
