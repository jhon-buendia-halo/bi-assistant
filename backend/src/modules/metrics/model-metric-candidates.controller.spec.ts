import { Reflector } from '@nestjs/core';
import {
  AUTH_REQUIREMENT_KEY,
  type AuthRequirement,
} from '../../common/decorators/auth-requirement.decorators';
import type { MetricsService } from './metrics.service';
import { ModelMetricCandidatesController } from './model-metric-candidates.controller';

describe('ModelMetricCandidatesController', () => {
  it('needs use-agents: reading metric candidates changes nothing (data-model R38)', () => {
    const requirement = new Reflector().getAllAndOverride<
      AuthRequirement | undefined
    >(AUTH_REQUIREMENT_KEY, [
      Object.getOwnPropertyDescriptor(
        ModelMetricCandidatesController.prototype,
        'candidatesForModel',
      )?.value as () => unknown,
      ModelMetricCandidatesController,
    ]);
    expect(requirement).toEqual({
      kind: 'permission',
      permission: 'use-agents',
    });
  });

  it("answers the dataset's candidates from MetricsService", async () => {
    const candidates = [
      {
        verifiedQueryId: 'vq1',
        name: 'avg_attendance',
        label: 'Average attendance',
        entity: 'matches',
        sql: 'select avg(attendance) from matches',
      },
    ];
    const candidatesForDataset = jest.fn().mockResolvedValue(candidates);
    const metrics = { candidatesForDataset } as unknown as MetricsService;
    const controller = new ModelMetricCandidatesController(metrics);
    await expect(
      controller.candidatesForModel('World Cup Core'),
    ).resolves.toEqual({ candidates });
    expect(candidatesForDataset).toHaveBeenCalledWith('World Cup Core');
  });
});
