/**
 * Developer observability (ADR-0006): when the developer setting is on, the
 * entry points start the OpenTelemetry Node SDK before they import the app,
 * because auto-instrumentation only patches modules loaded after it starts.
 *
 * The SDK packages are only ever reached through dynamic imports inside
 * `loadNodeSdk`, so with the setting off no OpenTelemetry module is loaded.
 * Keep this file free of static imports from `@opentelemetry/*`, Nest or any
 * app module.
 */
import type { DeveloperSettings } from '../developer-settings/developer-settings.file';

export const TELEMETRY_SERVICE_NAME = 'questions-to-insights';
export const METRIC_EXPORT_INTERVAL_MS = 10_000;

export interface TelemetryHandle {
  shutdown(): Promise<void>;
}

export type TelemetryLoader = (
  settings: DeveloperSettings,
) => Promise<TelemetryHandle>;

/**
 * Starts telemetry when the setting is on. Never throws: a failure to start
 * logs one warning and the backend runs without it.
 */
export async function startDeveloperTelemetry(
  settings: DeveloperSettings,
  load: TelemetryLoader = loadNodeSdk,
): Promise<TelemetryHandle | null> {
  if (!settings.observabilityEnabled) return null;
  try {
    return await load(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[telemetry] developer observability is on but OpenTelemetry did not start: ${message}`,
    );
    return null;
  }
}

async function loadNodeSdk(
  settings: DeveloperSettings,
): Promise<TelemetryHandle> {
  const [
    { NodeSDK },
    { getNodeAutoInstrumentations },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { PeriodicExportingMetricReader },
    { resourceFromAttributes },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/auto-instrumentations-node'),
    import('@opentelemetry/exporter-trace-otlp-proto'),
    import('@opentelemetry/exporter-metrics-otlp-proto'),
    import('@opentelemetry/sdk-metrics'),
    import('@opentelemetry/resources'),
  ]);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': TELEMETRY_SERVICE_NAME,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${settings.otlpEndpoint}/v1/traces`,
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${settings.otlpEndpoint}/v1/metrics`,
        }),
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noise without insight for this app: every file read, DNS lookup
        // and socket would become a span.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}
