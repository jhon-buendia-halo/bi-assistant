import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard, INTELLIFY_API_KEYS } from './api-key.guard';
import type { IntellifyDbConfig } from './config';
import { DbService, INTELLIFY_DB_CONFIG } from './db/db.service';
import { IntellifyReadModule } from './intellify/intellify.module';
import { PackageModule } from './package/package.module';
import { RfpModule } from './rfp/rfp.module';
import { INTELLIFY_API_VERSION, ServiceController } from './service.controller';

export interface IntellifyApiModuleOptions {
  db: IntellifyDbConfig;
  apiKeys: string[];
  version: string;
}

/**
 * Root of the Intellify RFP API (ADR-0027). `DbService` is global, so the
 * feature modules below inject it without importing anything.
 */
@Global()
@Module({})
export class IntellifyApiModule {
  static register(options: IntellifyApiModuleOptions): DynamicModule {
    return {
      module: IntellifyApiModule,
      imports: [
        // Feature modules: each owns its controllers and services.
        IntellifyReadModule,
        RfpModule,
        PackageModule,
      ],
      controllers: [ServiceController],
      providers: [
        { provide: INTELLIFY_DB_CONFIG, useValue: options.db },
        { provide: INTELLIFY_API_KEYS, useValue: options.apiKeys },
        { provide: INTELLIFY_API_VERSION, useValue: options.version },
        DbService,
        { provide: APP_GUARD, useClass: ApiKeyGuard },
      ],
      exports: [DbService],
    };
  }
}
