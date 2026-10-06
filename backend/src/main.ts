import { startupDeveloperSettings } from './infrastructure/developer-settings/developer-settings.file';
import { startDeveloperTelemetry } from './infrastructure/telemetry/developer-telemetry';

async function bootstrap() {
  // Telemetry must start before the app is imported: auto-instrumentation
  // only patches modules loaded after it (ADR-0006).
  await startDeveloperTelemetry(startupDeveloperSettings());
  const { createApp } = await import('./app-bootstrap.js');
  await createApp({
    port: Number(process.env.PORT ?? 3000),
    // Renderer runs from file:// inside Electron (Origin: null) — allow it.
    cors: true,
  });
}
bootstrap();
