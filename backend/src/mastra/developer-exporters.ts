import type { ArizeExporter } from '@mastra/arize';
import {
  type DeveloperSettings,
  startupDeveloperSettings,
} from '../infrastructure/developer-settings/developer-settings.file';

export const PHOENIX_PROJECT_NAME = 'questions-to-insights';

type ArizeModule = typeof import('@mastra/arize');

function requireArize(): ArizeModule {
  // A plain require keeps the exporter (and the OpenTelemetry packages under
  // it) off the module graph unless developer observability is on (ADR-0006).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@mastra/arize') as ArizeModule;
}

/**
 * Trace exporters added next to the local store when the active developer
 * setting is on: agent traces also go to Arize Phoenix. Never throws.
 */
export function developerTraceExporters(
  settings: DeveloperSettings = startupDeveloperSettings(),
  load: () => ArizeModule = requireArize,
): ArizeExporter[] {
  if (!settings.observabilityEnabled) return [];
  try {
    const { ArizeExporter } = load();
    return [
      new ArizeExporter({
        endpoint: `${settings.phoenixEndpoint}/v1/traces`,
        projectName: PHOENIX_PROJECT_NAME,
      }),
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[telemetry] developer observability is on but the Phoenix exporter did not load: ${message}`,
    );
    return [];
  }
}
