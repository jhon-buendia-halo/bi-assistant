import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const OPENAPI_PATH = 'openapi.json';

/**
 * Generates the document from the controllers and DTOs and serves it, public,
 * at `GET /openapi.json` (api.md 2.16.1 I2). The Swagger UI is off.
 */
export function mountOpenApi(app: INestApplication, version: string) {
  const config = new DocumentBuilder()
    .setTitle('Intellify RFP API')
    .setDescription('Intellify data and RFP records for the RFP Builder.')
    .setVersion(version)
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addSecurityRequirements('api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: OPENAPI_PATH,
    swaggerUiEnabled: false,
  });
  return document;
}
