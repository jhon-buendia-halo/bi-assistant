import { createApp } from './app-bootstrap';

async function bootstrap() {
  await createApp({
    port: Number(process.env.PORT ?? 3000),
    // Renderer runs from file:// inside Electron (Origin: null) — allow it.
    cors: true,
  });
}
bootstrap();
