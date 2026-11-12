import { resolveAgentModelConfig } from '../../../mastra/model-resolver';
import {
  providerOptionsFor,
  type ProviderOptionValue,
  type ProviderOptions,
} from '../../../mastra/model-compat';
import type { DatasetsRepository } from '../../datasets/repositories/datasets.repository';
import type { DatasourcesService } from '../../datasources/datasources.service';
import type { SessionDoc } from '../entities/session.entity';

/**
 * Provider options filed under the bucket the configured model actually
 * reads. Mastra names an OpenAI-compatible client's bucket after the
 * provider id, so a hardcoded `openai` key is silently discarded for every
 * `lenai/…` deployment — which is how the reasoning-effort chip came to be
 * a no-op there.
 */
export async function turnProviderOptions(
  bucket: Record<string, ProviderOptionValue>,
  modelOverride?: string,
): Promise<ProviderOptions> {
  return providerOptionsFor(
    await resolveAgentModelConfig(modelOverride),
    bucket,
  );
}

/**
 * A session's datasets as its turns and tools see them: bound to a
 * datasource, with the datasource's name and the session's sole datasource.
 */
export class SessionDatasets {
  constructor(
    private readonly datasetsRepository: DatasetsRepository,
    private readonly datasourcesService: DatasourcesService,
  ) {}

  /**
   * Datasets created before datasources existed carry no binding — attach
   * the preferred saved datasource so tools can still run.
   */
  async bound(names: string[]) {
    const datasets = await this.datasetsRepository.getByNames(names);
    if (datasets.every((s) => s.datasourceId)) return datasets;
    const fallback = await this.datasourcesService.defaultDatasource();
    return datasets.map((s) =>
      s.datasourceId || !fallback
        ? s
        : {
            ...s,
            datasourceId: fallback.id,
            datasourceKind: fallback.kind,
          },
    );
  }

  /** A datasource's name, or its id when it cannot be read. */
  async datasourceName(datasourceId: string): Promise<string> {
    try {
      return (await this.datasourcesService.get(datasourceId)).name;
    } catch {
      return datasourceId;
    }
  }

  /** The session's datasource when it is unambiguous — provenance only. */
  async soleDatasourceId(session: SessionDoc): Promise<string | undefined> {
    const datasets = await this.bound(session.datasets);
    const ids = new Set(
      datasets.map((s) => s.datasourceId).filter((id): id is string => !!id),
    );
    return ids.size === 1 ? Array.from(ids)[0] : undefined;
  }
}
