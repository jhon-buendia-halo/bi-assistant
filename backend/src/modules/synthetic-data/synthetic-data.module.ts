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

@Module({
  imports: [DatasourcesModule, DatasetsModule],
  controllers: [SyntheticDataController],
  providers: [
    SyntheticDataService,
    { provide: ProfileCache, useFactory: () => new ProfileCache() },
    { provide: SAMPLED_PROFILE_BUILDER, useValue: buildSampledProfile },
  ],
  exports: [SyntheticDataService],
})
export class SyntheticDataModule {}
