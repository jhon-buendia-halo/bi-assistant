import { Module } from '@nestjs/common';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { buildSampledProfile } from './profile/build-sampled-profile';
import { ProfileCache } from './profile-cache';
import { SyntheticDataController } from './synthetic-data.controller';
import {
  SAMPLED_PROFILE_BUILDER,
  SyntheticDataService,
} from './synthetic-data.service';
import { SYNTHETIC_DATA_SERVICE } from './synthetic-data.token';

@Module({
  imports: [DatasourcesModule, DatasetsModule],
  controllers: [SyntheticDataController],
  providers: [
    SyntheticDataService,
    { provide: ProfileCache, useFactory: () => new ProfileCache() },
    { provide: SAMPLED_PROFILE_BUILDER, useValue: buildSampledProfile },
    // The Data Readiness Agent's tools reach it through this token (agents.md 3.14).
    { provide: SYNTHETIC_DATA_SERVICE, useExisting: SyntheticDataService },
  ],
  exports: [SyntheticDataService, SYNTHETIC_DATA_SERVICE],
})
export class SyntheticDataModule {}
