// The Data Readiness Agent's synthetic-data tools on the session side (story
// 1.22.4; agents.md 3.14, ADR-0039): dataset and table resolution, the chat
// limits, the script saved in the session workspace and its `file` panel
// item. Kept out of sessions.service.ts so the orchestrator only wires it in.

import type {
  SyntheticDataToolServices,
  SyntheticScriptResult,
} from '../../mastra/synthetic-data-tool-services';
import {
  CHAT_ROWS_PER_TABLE_MAX,
  CHAT_TABLES_MAX,
} from '../synthetic-data/limits';
import type { SyntheticDataService } from '../synthetic-data/synthetic-data.service';
import type {
  SampledProfile,
  SampledRelationship,
} from '../synthetic-data/types';
import {
  resolveSessionDataset,
  type ReadinessBridgeDeps,
  type ReadinessDataset,
} from './readiness-bridge';

/** The workspace folder the scripts are saved in (data-model 3.4.4). */
export const SYNTHETIC_DATA_FOLDER = 'synthetic-data';

export const ERR_UNSUPPORTED =
  'Synthetic data supports PostgreSQL and Databricks datasets only';
export const ERR_CHAT_TABLES =
  'Choose at most 20 tables in chat; use Profile & synthesize on the dataset for more';
export const ERR_CHAT_ROWS =
  'rowsPerTable must be a whole number from 1 to 1,000 in chat';
export const errNotATable = (name: string, dataset: string): string =>
  `"${name}" is not a table of dataset "${dataset}"`;
export const errProfileGone = (id: string): string =>
  `Profile "${id}" expired or not found: profile the tables again`;

export interface SyntheticDataBridgeDeps extends Pick<
  ReadinessBridgeDeps,
  'sessionDatasetNames' | 'datasets'
> {
  synthetic: Pick<
    SyntheticDataService,
    'profile' | 'getProfile' | 'scriptText'
  >;
  /** Write a text file into the session workspace (creating its folder). */
  writeFile(sessionId: string, path: string, text: string): Promise<void>;
  /** Store a `file` panel item for a workspace file; resolves to its id. */
  showFile(
    sessionId: string,
    path: string,
    title: string,
  ): Promise<{ id: string }>;
}

/** The synthetic-data tools of agents.md 3.14: each shows its step. */
export const SYNTHETIC_DATA_TOOLS: ReadonlySet<string> = new Set([
  'profile_data_sample',
  'generate_synthetic_data',
]);

/**
 * The panel item id a successful `generate_synthetic_data` result names, for
 * the `panel-item` event; undefined for an error or any other shape.
 */
export function syntheticPanelItemId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const value = result as { error?: unknown; panelItemId?: unknown };
  if (typeof value.error === 'string') return undefined;
  return typeof value.panelItemId === 'string' && value.panelItemId
    ? value.panelItemId
    : undefined;
}

/** The panel item's title (agents.md 3.14). */
export function syntheticPanelTitle(dataset: string, seed: number): string {
  return `Synthetic data — ${dataset} (seed ${seed})`;
}

/**
 * The entity keys `names` stand for in `dataset` (agents.md 3.14): each name is
 * an entity key, or a bare table name matching every key that ends in it
 * (case-insensitive). No names means every table. More than 20 is refused.
 */
export function resolveTables(
  dataset: Pick<ReadinessDataset, 'name' | 'tables'>,
  names: readonly string[] | undefined,
): string[] {
  let keys = [...dataset.tables];
  if (names?.length) {
    const found = new Set<string>();
    for (const name of names) {
      const lower = name.toLowerCase();
      const exact =
        dataset.tables.find((k) => k === name) ??
        dataset.tables.find((k) => k.toLowerCase() === lower);
      const matches = exact
        ? [exact]
        : dataset.tables.filter(
            (k) => k.split('.').pop()?.toLowerCase() === lower,
          );
      if (!matches.length) throw new Error(errNotATable(name, dataset.name));
      for (const key of matches) found.add(key);
    }
    // Dataset order, as the editor profiles them.
    keys = dataset.tables.filter((k) => found.has(k));
  }
  if (keys.length > CHAT_TABLES_MAX) throw new Error(ERR_CHAT_TABLES);
  return keys;
}

/** `rowsPerTable` within the chat limit: a whole number from 1 to 1,000. */
export function chatRowsPerTable(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > CHAT_ROWS_PER_TABLE_MAX
  ) {
    throw new Error(ERR_CHAT_ROWS);
  }
  return value;
}

/** A profile cut to `keys`, keeping the relationships that leave from them. */
function subProfile(profile: SampledProfile, keys: string[]): SampledProfile {
  const wanted = new Set(keys);
  return {
    ...profile,
    tables: profile.tables.filter((t) => wanted.has(t.key)),
    relationships: profile.relationships.filter((r) => wanted.has(r.fromTable)),
  };
}

function relationshipEnd(table: string, columns: string[]): string {
  return `${table}(${columns.join(', ')})`;
}

function relationshipView(r: SampledRelationship): {
  from: string;
  to: string;
} {
  return {
    from: relationshipEnd(r.fromTable, r.fromColumns),
    to: relationshipEnd(r.toTable, r.toColumns),
  };
}

/**
 * The synthetic-data tool-services bridge (agents.md 3.14), installed by
 * `SessionsService.onModuleInit`. Every failure throws an Error whose message
 * is the text the model sees.
 */
export class SyntheticDataBridge implements SyntheticDataToolServices {
  constructor(private readonly deps: SyntheticDataBridgeDeps) {}

  async profileSample(input: {
    sessionId: string;
    datasetName?: string;
    tables?: string[];
    signal?: AbortSignal;
  }): Promise<SampledProfile> {
    const dataset = await this.dataset(input.sessionId, input.datasetName);
    const keys = resolveTables(dataset, input.tables);
    return this.deps.synthetic.profile(
      { datasetName: dataset.name, tables: keys },
      { signal: input.signal },
    );
  }

  async generateScript(input: {
    sessionId: string;
    datasetName?: string;
    tables?: string[];
    rowsPerTable?: number;
    seed?: number;
    targetSchema?: string;
    profileId?: string;
    signal?: AbortSignal;
  }): Promise<SyntheticScriptResult> {
    const dataset = await this.dataset(input.sessionId, input.datasetName);
    const keys = resolveTables(dataset, input.tables);
    const rows = chatRowsPerTable(input.rowsPerTable);

    let profile: SampledProfile;
    const profileId = input.profileId?.trim();
    if (profileId) {
      const cached = this.deps.synthetic.getProfile(profileId);
      if (!cached || cached.datasetName !== dataset.name) {
        throw new Error(errProfileGone(profileId));
      }
      if (input.tables?.length) {
        const missing = keys.find(
          (k) => !cached.tables.some((t) => t.key === k),
        );
        if (missing) {
          throw new Error(`"${missing}" is not a table of this profile`);
        }
        profile = subProfile(cached, keys);
      } else {
        profile = cached;
      }
    } else {
      profile = await this.deps.synthetic.profile(
        { datasetName: dataset.name, tables: keys },
        { signal: input.signal },
      );
    }

    const script = this.deps.synthetic.scriptText(profile, {
      ...(rows !== undefined ? { defaultRowCount: rows } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.targetSchema ? { targetSchema: input.targetSchema } : {}),
    });
    const path = `${SYNTHETIC_DATA_FOLDER}/${script.fileName}`;
    await this.deps.writeFile(input.sessionId, path, script.text);
    const item = await this.deps.showFile(
      input.sessionId,
      path,
      syntheticPanelTitle(dataset.name, script.plan.seed),
    );

    const byKey = new Map(profile.tables.map((t) => [t.key, t]));
    return {
      fileName: script.fileName,
      path,
      panelItemId: item.id,
      dialect: profile.dialect,
      seed: script.plan.seed,
      targetSchema: script.plan.targetSchema,
      bytes: script.bytes,
      tables: script.plan.tables.map((t) => ({ table: t.key, rows: t.rows })),
      droppedRelationships:
        script.plan.droppedRelationships.map(relationshipView),
      notSynthesized: script.plan.tables.flatMap((t) =>
        (byKey.get(t.key)?.columns ?? [])
          .filter(
            (c) => c.strategy === 'null-only' || c.strategy === 'constant',
          )
          .map((c) => ({
            table: t.key,
            column: c.name,
            reason:
              c.note ??
              (c.strategy === 'null-only'
                ? 'generated as NULL'
                : 'generated as a neutral value'),
          })),
      ),
    };
  }

  private dataset(sessionId: string, datasetName?: string) {
    return resolveSessionDataset(
      this.deps,
      sessionId,
      datasetName,
      ERR_UNSUPPORTED,
    );
  }
}
