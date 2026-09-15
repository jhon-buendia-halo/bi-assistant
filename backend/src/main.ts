import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Renderer runs from file:// inside Electron (Origin: null) — allow it.
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
