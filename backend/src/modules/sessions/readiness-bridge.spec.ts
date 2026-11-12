import { BadGatewayException, NotFoundException } from '@nestjs/common';
import type {
  Finding,
  ReadinessReport,
  Severity,
} from '../data-readiness/engine/types';
import {
  ReadinessBridge,
  readinessOrientationBlock,
  readinessPanelItem,
  readinessReportIdOf,
  readinessReportOf,
  readinessReportRef,
  readinessSummary,
  topFindings,
  type ReadinessBridgeDeps,
  type ReadinessDataset,
} from './readiness-bridge';

function finding(severity: Severity, entity: string): Finding {
  return {
    dimension: 'completeness',
    level: 'entity',
    namespace: 'public',
    entity,
    field: 'col',
    severity,
    measured: 0.2,
    description: `${severity} ${entity}`,
    recommendation: 'Fill it',
  };
}

function report(id: string, findings: Finding[] = []): ReadinessReport {
  return {
    id,
    datasourceId: 'ds-pg',
    datasourceName: 'World Cup DB',
    datasourceKind: 'postgres',
    generatedAt: '2026-11-03T10:00:00.000Z',
    entityCount: 3,
    overallScore: 88,
    maturity: 'Managed',
    dimensionScores: [
      {
        dimension: 'completeness',
        score: 0,
        findingCount: findings.length,
        maxSeverity: findings.length ? 'high' : null,
        assessed: true,
        totalChecks: 4,
      },
    ],
    findings,
  };
}

const DATASETS: Record<string, ReadinessDataset> = {
  'World Cup': {
    name: 'World Cup',
    datasourceId: 'ds-pg',
    datasourceKind: 'postgres',
    tables: ['wc.public.matches', 'wc.public.teams'],
  },
  Sales: {
    name: 'Sales',
    datasourceId: 'ds-dbx',
    datasourceKind: 'databricks',
    tables: ['main.sales.orders'],
  },
  Api: {
    name: 'Api',
    datasourceId: 'ds-rest',
    datasourceKind: 'rest',
    tables: ['api.x'],
  },
};

function build(sessionDatasets: string[]) {
  const readiness = {
    assess: jest.fn().mockResolvedValue(report('r-new')),
    list: jest.fn().mockResolvedValue({ reports: [] }),
    get: jest
      .fn()
      .mockImplementation((id: string) =>
        id === 'missing'
          ? Promise.reject(
              new NotFoundException(`Readiness report "${id}" not found`),
            )
          : Promise.resolve(report(id)),
      ),
  };
  const deps: ReadinessBridgeDeps = {
    sessionDatasetNames: jest.fn().mockResolvedValue(sessionDatasets),
    datasets: jest.fn((names: string[]) =>
      Promise.resolve(
        names.map((name) => DATASETS[name]).filter((d) => d !== undefined),
      ),
    ),
    datasourceName: jest.fn((id: string) =>
      Promise.resolve(id === 'ds-pg' ? 'World Cup DB' : `name of ${id}`),
    ),
    readiness,
  };
  return { bridge: new ReadinessBridge(deps), readiness, deps };
}

describe('readiness summary (agents.md 3.13)', () => {
  it('includes notProfiled only when the report has some', () => {
    const base = report('r-np', []);
    expect(readinessSummary(base)).not.toHaveProperty('notProfiled');
    const np = [{ entity: 'a.b', reason: 'too-large' as const, rowCount: 9 }];
    expect(readinessSummary({ ...base, notProfiled: np }).notProfiled).toEqual(
      np,
    );
  });

  it('passes signal and onProgress to the data-readiness service only when given', async () => {
    const ctx = build(['World Cup']);
    const signal = new AbortController().signal;
    const onProgress = jest.fn();
    await ctx.bridge.assessReadiness({ sessionId: 's-1', signal, onProgress });
    expect(ctx.readiness.assess).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceId: 'ds-pg' }),
      undefined,
      { signal, onProgress },
    );
  });

  it('keeps at most 20 findings, most severe first, then in report order', () => {
    const findings = [
      finding('low', 'a'),
      finding('high', 'b'),
      finding('info', 'c'),
      finding('medium', 'd'),
      finding('high', 'e'),
      ...Array.from({ length: 20 }, (_, i) => finding('medium', `m${i}`)),
    ];
    const top = topFindings(findings);
    expect(top).toHaveLength(20);
    expect(top.slice(0, 4).map((f) => f.entity)).toEqual(['b', 'e', 'd', 'm0']);
    expect(top.every((f) => f.severity !== 'low')).toBe(true);

    const summary = readinessSummary(report('r-1', findings));
    expect(summary).toMatchObject({
      reportId: 'r-1',
      datasourceName: 'World Cup DB',
      generatedAt: '2026-11-03T10:00:00.000Z',
      entityCount: 3,
      overallScore: 88,
      maturity: 'Managed',
      findingCount: 25,
    });
    expect(summary.topFindings).toHaveLength(20);
    expect(summary.topFindings[0]).toEqual({
      severity: 'high',
      dimension: 'completeness',
      entity: 'b',
      field: 'col',
      measured: 0.2,
      description: 'high b',
      recommendation: 'Fill it',
    });
    expect(summary.dimensionScores).toHaveLength(1);
  });
});

describe('the readiness panel item and answer reference (data-model 3.4)', () => {
  it('builds a readiness item with the report id and datasource title', () => {
    expect(
      readinessPanelItem(report('r-1'), new Date('2026-11-03T11:00:00Z')),
    ).toEqual({
      id: 'readiness:r-1',
      kind: 'readiness',
      title: 'Data readiness — World Cup DB',
      shownAt: '2026-11-03T11:00:00.000Z',
      reportId: 'r-1',
    });
    expect(readinessReportRef(report('r-1'))).toEqual({
      reportId: 'r-1',
      datasourceName: 'World Cup DB',
      overallScore: 88,
      maturity: 'Managed',
      generatedAt: '2026-11-03T10:00:00.000Z',
    });
  });

  it('reads the full report of a raw { summary, report } tool result', () => {
    const full = report('r-1');
    expect(readinessReportOf({ summary: {}, report: full })).toBe(full);
    expect(readinessReportOf({ reportId: 'r-1' })).toBeUndefined();
    expect(readinessReportOf({ report: { id: 'r-1' } })).toBeUndefined();
    expect(readinessReportOf({ error: 'x', report: full })).toBeUndefined();
    expect(readinessReportOf(undefined)).toBeUndefined();
  });

  it('reads the report id of a tool result, never of an error', () => {
    expect(readinessReportIdOf({ reportId: 'r-1' })).toBe('r-1');
    expect(readinessReportIdOf({ summary: { reportId: 'r-2' } })).toBe('r-2');
    expect(readinessReportIdOf({ report: { id: 'r-3' } })).toBe('r-3');
    expect(readinessReportIdOf({ error: 'x', reportId: 'r-1' })).toBe(
      undefined,
    );
    expect(readinessReportIdOf(null)).toBeUndefined();
    expect(readinessReportIdOf('r-1')).toBeUndefined();
  });

  it('writes Block D1 with each dataset and today, and no score', () => {
    expect(
      readinessOrientationBlock(
        [
          {
            name: 'World Cup',
            datasourceKind: 'postgres',
            datasourceName: 'World Cup DB',
            entityCount: 2,
          },
          {
            name: 'Sales',
            datasourceKind: 'databricks',
            datasourceName: 'Lakehouse',
            entityCount: 1,
          },
        ],
        '2026-11-03',
      ),
    ).toBe(
      [
        'Datasets for this session (data readiness):',
        '- World Cup — PostgreSQL datasource "World Cup DB", 2 entities',
        '- Sales — Databricks datasource "Lakehouse", 1 entities',
        'Today is 2026-11-03.',
      ].join('\n'),
    );
  });

  it('adds the datasource id and an example entity key when known (ADR-0035)', () => {
    expect(
      readinessOrientationBlock(
        [
          {
            name: 'Formula 1',
            datasourceKind: 'postgres',
            datasourceName: 'Formula 1 PostgreSQL',
            datasourceId: 'ds-f1',
            entityCount: 48,
            exampleEntity: 'formula1.formula1.chassis',
          },
        ],
        '2026-11-09',
      ),
    ).toBe(
      [
        'Datasets for this session (data readiness):',
        '- Formula 1 — PostgreSQL datasource "Formula 1 PostgreSQL" (datasourceId ds-f1), 48 entities, named like formula1.formula1.chassis',
        'Today is 2026-11-09.',
      ].join('\n'),
    );
  });
});

describe('ReadinessBridge (agents.md 3.13)', () => {
  describe('dataset resolution', () => {
    it('uses the only session dataset when none is named', async () => {
      const ctx = build(['World Cup']);
      const result = await ctx.bridge.assessReadiness({ sessionId: 's-1' });
      expect(ctx.readiness.assess).toHaveBeenCalledWith({
        datasourceId: 'ds-pg',
        entities: ['wc.public.matches', 'wc.public.teams'],
        sessionId: 's-1',
      });
      expect(result.report.id).toBe('r-new');
      expect(result.summary.reportId).toBe('r-new');
    });

    it('a report from a run stores runId and no sessionId (1.23.16)', async () => {
      const ctx = build(['World Cup']);
      await ctx.bridge.assessReadiness({ sessionId: 'run-7f3a' });
      expect(ctx.readiness.assess).toHaveBeenCalledWith({
        datasourceId: 'ds-pg',
        entities: ['wc.public.matches', 'wc.public.teams'],
        runId: '7f3a',
      });
    });

    it('asks to name one when the session has several', async () => {
      const ctx = build(['Sales', 'World Cup']);
      for (const call of [
        () => ctx.bridge.assessReadiness({ sessionId: 's-1' }),
        () => ctx.bridge.getReadinessReport({ sessionId: 's-1' }),
        () => ctx.bridge.listReadinessReports({ sessionId: 's-1' }),
      ]) {
        await expect(call()).rejects.toThrow(
          'This session has several datasets: Sales, World Cup. Name the one to assess.',
        );
      }
      expect(ctx.readiness.assess).not.toHaveBeenCalled();
    });

    it('refuses a dataset that is not in the session', async () => {
      const ctx = build(['Sales', 'World Cup']);
      await expect(
        ctx.bridge.assessReadiness({ sessionId: 's-1', datasetName: 'Api' }),
      ).rejects.toThrow(
        'Dataset "Api" is not in this session. Choose one of: Sales, World Cup.',
      );
    });

    it('picks a named dataset, case-insensitively', async () => {
      const ctx = build(['Sales', 'World Cup']);
      await ctx.bridge.assessReadiness({
        sessionId: 's-1',
        datasetName: 'sales',
      });
      expect(ctx.readiness.assess).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceId: 'ds-dbx' }),
      );
    });

    it('refuses a dataset whose datasource is not PostgreSQL or Databricks', async () => {
      const ctx = build(['Api']);
      await expect(
        ctx.bridge.assessReadiness({ sessionId: 's-1' }),
      ).rejects.toThrow(
        'Data readiness supports PostgreSQL and Databricks datasources only',
      );
    });
  });

  describe('errors', () => {
    it('names the unreachable datasource', async () => {
      const ctx = build(['World Cup']);
      ctx.readiness.assess.mockRejectedValue(
        new BadGatewayException('connect ECONNREFUSED'),
      );
      await expect(
        ctx.bridge.assessReadiness({ sessionId: 's-1' }),
      ).rejects.toThrow('Could not reach "World Cup DB": connect ECONNREFUSED');
    });

    it("passes the service's other messages through", async () => {
      const ctx = build(['World Cup']);
      ctx.readiness.assess.mockRejectedValue(
        new Error('None of the entities to assess exist'),
      );
      await expect(
        ctx.bridge.assessReadiness({ sessionId: 's-1' }),
      ).rejects.toThrow('None of the entities to assess exist');
      await expect(
        ctx.bridge.getReadinessReport({
          sessionId: 's-1',
          reportId: 'missing',
        }),
      ).rejects.toThrow('Readiness report "missing" not found');
    });

    it("refuses a report id of another datasource than the session's", async () => {
      const ctx = build(['Sales']);
      await expect(
        ctx.bridge.getReadinessReport({ sessionId: 's-1', reportId: 'r-1' }),
      ).rejects.toThrow('Readiness report "r-1" not found');
    });

    it('says when no report is stored yet', async () => {
      const ctx = build(['World Cup']);
      await expect(
        ctx.bridge.getReadinessReport({ sessionId: 's-1' }),
      ).rejects.toThrow('No assessment has been run for "World Cup DB" yet.');
    });
  });

  it("reads the newest report of the dataset's datasource, or one by id", async () => {
    const ctx = build(['World Cup']);
    ctx.readiness.list.mockResolvedValue({
      reports: [{ id: 'r-2' }, { id: 'r-1' }],
    });
    const latest = await ctx.bridge.getReadinessReport({ sessionId: 's-1' });
    expect(ctx.readiness.list).toHaveBeenCalledWith('ds-pg');
    expect(latest.report.id).toBe('r-2');
    const byId = await ctx.bridge.getReadinessReport({
      sessionId: 's-1',
      reportId: 'r-1',
    });
    expect(byId.summary.reportId).toBe('r-1');
  });

  it("lists the dataset's reports, newest first, as the tool's output", async () => {
    const ctx = build(['World Cup']);
    ctx.readiness.list.mockResolvedValue({
      reports: [report('r-2'), report('r-1')],
    });
    expect(await ctx.bridge.listReadinessReports({ sessionId: 's-1' })).toEqual(
      {
        datasourceName: 'World Cup DB',
        reports: ['r-2', 'r-1'].map((reportId) => ({
          reportId,
          generatedAt: '2026-11-03T10:00:00.000Z',
          overallScore: 88,
          maturity: 'Managed',
          entityCount: 3,
        })),
        total: 2,
      },
    );
  });

  it('remembers the reports it resolved for the stream event', async () => {
    const ctx = build(['World Cup']);
    const assessed = await ctx.bridge.assessReadiness({ sessionId: 's-1' });
    expect(await ctx.bridge.reportFor('r-new')).toBe(assessed.report);
    expect(ctx.readiness.get).not.toHaveBeenCalled();
    // Not resolved here: read from the store, or undefined when unknown.
    expect((await ctx.bridge.reportFor('r-9'))?.id).toBe('r-9');
    expect(await ctx.bridge.reportFor('missing')).toBeUndefined();
  });
});
