import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BankConfigResponse,
  HindsightClient,
} from '@vectorize-io/hindsight-client';
import { HINDSIGHT_CLIENT } from '../../infrastructure/memory/hindsight.client';
import { bankIdFor } from './hindsight-learning-store';

/** What retain extracts from a signal — rules, never data. */
export const RETAIN_MISSION =
  'Extract business rules for querying this database: correct tables, columns, filters and metric definitions, and the mistakes analysts corrected. Ignore row values and personal data.';
export const OBSERVATIONS_MISSION =
  'Consolidate rules for answering analytics questions with SQL on this schema.';
export const REFLECT_MISSION =
  'Curate the knowledge base of a BI assistant. Prefer rules backed by several signals.';

/** Hard rules the bank's reflect (and so its mental models) must follow. */
export const BANK_DIRECTIVES: readonly { name: string; content: string }[] = [
  {
    name: 'curated-wins',
    content:
      'When a memory contradicts curated Knowledge, the curated Knowledge is correct.',
  },
  {
    name: 'no-values',
    content: 'Never quote row values, names, emails or other personal data.',
  },
];

/**
 * The summaries the bank keeps current after each consolidation; the
 * `recall+models` lever puts them in the turn.
 */
export const BANK_MENTAL_MODELS: readonly {
  id: string;
  name: string;
  sourceQuery: string;
}[] = [
  {
    id: 'known-pitfalls',
    name: 'Errores conocidos',
    sourceQuery:
      'Which mistakes did analysts correct when this database was queried (wrong tables, columns, joins, filters or metric definitions), and what is the correct approach for each?',
  },
  {
    id: 'table-guide',
    name: 'Guía de tablas',
    sourceQuery:
      'Which tables and columns answer which kinds of business questions on this database, and which joins and default filters apply to them?',
  },
  {
    id: 'learned-glossary',
    name: 'Glosario aprendido',
    sourceQuery:
      'Which business terms, metrics and abbreviations have analysts defined for this database, and how does each map to tables, columns and filters?',
  },
];

/** How long a bank that could not be set up waits before the next try. */
const RETRY_AFTER_MS = 60_000;

/**
 * Sets up one memory bank per datasource, lazily: the first recall or
 * retain for a datasource creates the bank with its missions, then its
 * directives and mental models, each only when missing. Done once per
 * process; a failure is logged, never thrown, and retried a minute later.
 */
@Injectable()
export class MemoryBankService {
  private readonly logger = new Logger(MemoryBankService.name);
  private readonly ready = new Map<string, Promise<void>>();
  private readonly retryAt = new Map<string, number>();

  constructor(
    @Inject(HINDSIGHT_CLIENT)
    private readonly client: HindsightClient | null,
  ) {}

  ensureBank(datasourceId: string): Promise<void> {
    const client = this.client;
    if (!client) return Promise.resolve();
    const known = this.ready.get(datasourceId);
    if (known) return known;
    if (Date.now() < (this.retryAt.get(datasourceId) ?? 0)) {
      return Promise.resolve();
    }
    const pending = this.setUp(client, datasourceId).catch((error) => {
      this.ready.delete(datasourceId);
      this.retryAt.set(datasourceId, Date.now() + RETRY_AFTER_MS);
      this.logger.warn(
        `Memory bank ${bankIdFor(datasourceId)} is not set up: ${errorText(error)}`,
      );
    });
    this.ready.set(datasourceId, pending);
    return pending;
  }

  private async setUp(
    client: HindsightClient,
    datasourceId: string,
  ): Promise<void> {
    const bank = bankIdFor(datasourceId);
    let config: BankConfigResponse | undefined;
    try {
      config = await client.getBankConfig(bank);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    // Create on 404 — and also when the bank exists without our missions: a
    // recall or retain that reached the server first created it with the
    // server's defaults. `createBank` is create-or-update.
    if (config?.config?.['retain_mission'] !== RETAIN_MISSION) {
      await client.createBank(bank, {
        name: `Halo BI · ${datasourceId}`,
        retainMission: RETAIN_MISSION,
        observationsMission: OBSERVATIONS_MISSION,
        reflectMission: REFLECT_MISSION,
        retainExtractionMode: 'concise',
        enableObservations: true,
      });
    }

    const directives = await client.listDirectives(bank);
    const named = new Set((directives.items ?? []).map((d) => d.name));
    for (const directive of BANK_DIRECTIVES) {
      if (named.has(directive.name)) continue;
      await client.createDirective(bank, directive.name, directive.content);
    }

    const models = await client.listMentalModels(bank);
    const ids = new Set((models.items ?? []).map((m) => m.id));
    for (const model of BANK_MENTAL_MODELS) {
      if (ids.has(model.id)) continue;
      await client.createMentalModel(bank, model.name, model.sourceQuery, {
        id: model.id,
        maxTokens: 800,
        trigger: {
          refreshAfterConsolidation: true,
          mode: 'full',
          budget: 'mid',
        },
      });
    }
    this.logger.log(`Memory bank ${bank} is set up`);
  }
}

/** A `HindsightError` (or any error) carrying HTTP 404. */
function isNotFound(error: unknown): boolean {
  return (error as { statusCode?: unknown } | undefined)?.statusCode === 404;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
