import { Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';
import { ArtifactsRepository } from './repositories/artifacts.repository';

/**
 * The artifacts (api.md 2.6.4; data-model 3.18): reusable context saved
 * from workflow runs. It depends on the datastore only, so the sessions
 * module (a run reads an artifact's dashboard) and the workflows module (a
 * run is saved as an artifact, and a run's input names one) both import it.
 */
@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactsService, ArtifactsRepository],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
