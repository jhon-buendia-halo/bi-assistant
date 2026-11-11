import { startupDeveloperSettings } from './infrastructure/developer-settings/developer-settings.file';
import {
  parseParentPid,
  watchParentProcess,
} from './infrastructure/process/parent-watchdog';
import { startDeveloperTelemetry } from './infrastructure/telemetry/developer-telemetry';

async function bootstrap() {
  // Spawned by the desktop shell: exit once it is gone, so a crashed window
  // never leaves this process holding the port (api.md 4.3, roadmap 1.7.21).
  const parentPid = parseParentPid(process.env.DESKTOP_PARENT_PID);
  if (parentPid !== null) {
    watchParentProcess(parentPid, {
      onParentGone: () => {
        console.log(
          `Desktop shell (pid ${parentPid}) is gone; stopping the backend`,
        );
        process.exit(0);
      },
    });
  }
  // Telemetry must start before the app is imported: auto-instrumentation
  // only patches modules loaded after it (ADR-0006).
  await startDeveloperTelemetry(startupDeveloperSettings());
  const { createApp } = await import('./app-bootstrap.js');
  await createApp({
    port: Number(process.env.PORT ?? 3000),
    // Renderer runs from file:// inside Electron (Origin: null) — allow it.
    cors: true,
    instanceId: process.env.BACKEND_INSTANCE_ID || undefined,
  });
}
bootstrap();
