import { RequestContext } from '@mastra/core/request-context';
import type {
  ReadinessReport,
  ReadinessSummary,
} from '../../modules/data-readiness/engine/types';
import {
  type ReadinessReportList,
  type ReadinessToolServices,
  setReadinessToolServices,
} from '../readiness-tool-services';
import {
  READINESS_REPORT_TOOLS,
  readinessModelOutput,
  readinessReportFromToolResult,
  readinessTools,
} from './readiness.tools';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext },
) => Promise<unknown>;

type ExecuteWith = (
  input: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<unknown>;

type ToModelOutput = (output: unknown) => unknown;

const REPORT: ReadinessReport = {
  id: 'rep-1',
  datasourceId: 'pg-1',
  datasourceName: 'Warehouse',
  datasourceKind: 'postgres',
  generatedAt: '2026-11-03T10:00:00.000Z',
  sessionId: 's-1',
  entityCount: 2,
  overallScore: 81.3,
  maturity: 'Defined',
  dimensionScores: [
    {
      dimension: 'completeness',
      score: 62.5,
      findingCount: 1,
      maxSeverity: 'high',
      assessed: true,
      totalChecks: 4,
    },
  ],
  findings: [
    {
      dimension: 'completeness',
      level: 'entity',
      namespace: 'public',
      entity: 'customers',
      field: 'email',
      severity: 'high',
      measured: 0.62,
      description: '62% of email values are missing.',
      recommendation: 'Make email required at capture.',
    },
  ],
};

const SUMMARY: ReadinessSummary = {
  reportId: 'rep-1',
  datasourceName: 'Warehouse',
  generatedAt: REPORT.generatedAt,
  entityCount: 2,
  overallScore: 81.3,
  maturity: 'Defined',
  dimensionScores: REPORT.dimensionScores,
  findingCount: 1,
  topFindings: [
    {
      severity: 'high',
      dimension: 'completeness',
      entity: 'customers',
      field: 'email',
      measured: 0.62,
      description: '62% of email values are missing.',
      recommendation: 'Make email required at capture.',
    },
  ],
};

const LIST: ReadinessReportList = {
  datasourceName: 'Warehouse',
  reports: [
    {
      reportId: 'rep-1',
      generatedAt: REPORT.generatedAt,
      overallScore: 81.3,
      maturity: 'Defined',
      entityCount: 2,
    },
  ],
  total: 1,
};

// The fake bridge's methods, kept apart so tests never unbind them.
let assess: jest.Mock;
let getReport: jest.Mock;
let listReports: jest.Mock;

function contextWith(sessionId: string | null = 's-1'): RequestContext {
  const context = new RequestContext();
  context.set('datasets', ['Warehouse', 'Lakehouse']);
  if (sessionId !== null) context.set('session-id', sessionId);
  return context;
}

function run(
  name: keyof typeof readinessTools,
  input: Record<string, unknown>,
  context = contextWith(),
): Promise<unknown> {
  const execute = readinessTools[name].execute as unknown as Execute;
  return execute(input, { requestContext: context });
}

/** What the model receives for a raw result, through the tool's own hook. */
function modelSees(
  name: keyof typeof readinessTools,
  result: unknown,
): unknown {
  const hook = (
    readinessTools[name] as unknown as { toModelOutput?: ToModelOutput }
  ).toModelOutput;
  return hook ? hook(result) : { type: 'json', value: result };
}

beforeEach(() => {
  assess = jest.fn().mockResolvedValue({ report: REPORT, summary: SUMMARY });
  getReport = jest.fn().mockResolvedValue({ report: REPORT, summary: SUMMARY });
  listReports = jest.fn().mockResolvedValue(LIST);
  const bridge: ReadinessToolServices = {
    assessReadiness: assess,
    getReadinessReport: getReport,
    listReadinessReports: listReports,
  };
  setReadinessToolServices(bridge);
});

describe('the readiness tools (agents.md 3.13)', () => {
  it('are the three readiness tools, the drill-down dataset tools, then show_in_panel and ask_clarification', () => {
    expect(Object.keys(readinessTools)).toEqual([
      'assess_data_readiness',
      'get_readiness_report',
      'list_readiness_reports',
      'describe_entity',
      'run_readonly_sql',
      'show_in_panel',
      'ask_clarification',
    ]);
    expect([...READINESS_REPORT_TOOLS]).toEqual([
      'assess_data_readiness',
      'get_readiness_report',
    ]);
  });

  it('describe every input, all scalars', () => {
    for (const name of [
      'assess_data_readiness',
      'get_readiness_report',
      'list_readiness_reports',
    ] as const) {
      const shape = (
        readinessTools[name].inputSchema as unknown as {
          shape: Record<string, { description?: string; _def: unknown }>;
        }
      ).shape;
      for (const field of Object.values(shape)) {
        expect(field.description).toBeTruthy();
      }
    }
  });

  describe('assess_data_readiness', () => {
    it('calls the bridge with the session and dataset and keeps the full report in its raw result', async () => {
      const result = await run('assess_data_readiness', {
        dataset: ' Warehouse ',
      });

      expect(assess).toHaveBeenCalledWith({
        sessionId: 's-1',
        datasetName: 'Warehouse',
      });
      expect(result).toEqual({ report: REPORT, summary: SUMMARY });
      expect(readinessReportFromToolResult(result)).toBe(REPORT);
    });

    it('passes the abort signal and a progress listener that writes data-readiness-progress chunks', async () => {
      const custom = jest.fn().mockResolvedValue(undefined);
      const signal = new AbortController().signal;
      const execute = readinessTools.assess_data_readiness
        .execute as unknown as ExecuteWith;

      await execute(
        {},
        {
          requestContext: contextWith(),
          abortSignal: signal,
          writer: { custom },
        },
      );

      const input = (assess.mock.calls as unknown[][])[0][0] as {
        signal?: AbortSignal;
        onProgress?: (p: unknown) => void;
      };
      expect(input.signal).toBe(signal);
      const progress = { phase: 'profiling', message: 'Profiling…' };
      input.onProgress?.(progress);
      expect(custom).toHaveBeenCalledWith({
        type: 'data-readiness-progress',
        data: progress,
        transient: true,
      });
    });

    it('does not fail when the writer throws or rejects', async () => {
      const execute = readinessTools.assess_data_readiness
        .execute as unknown as ExecuteWith;
      for (const custom of [
        jest.fn(() => {
          throw new Error('boom');
        }),
        jest.fn().mockRejectedValue(new Error('boom')),
      ]) {
        assess.mockImplementationOnce(
          (input: { onProgress?: (p: unknown) => void }) => {
            input.onProgress?.({ phase: 'scoring', message: 'x' });
            return Promise.resolve({ report: REPORT, summary: SUMMARY });
          },
        );
        await expect(
          execute({}, { requestContext: contextWith(), writer: { custom } }),
        ).resolves.toEqual({ report: REPORT, summary: SUMMARY });
      }
    });

    it('lets an AbortError propagate instead of returning { error }', async () => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      assess.mockRejectedValueOnce(abort);
      await expect(run('assess_data_readiness', {})).rejects.toBe(abort);
    });

    it('sends the model only the summary, never the findings list', async () => {
      const result = await run('assess_data_readiness', {});

      const seen = modelSees('assess_data_readiness', result);
      expect(seen).toEqual({ type: 'json', value: SUMMARY });
      expect(JSON.stringify(seen)).not.toContain('"findings"');
      expect(readinessModelOutput(result)).toBe(SUMMARY);
    });

    it('leaves a blank dataset out, so the bridge resolves the only one', async () => {
      await run('assess_data_readiness', { dataset: '  ' });
      expect(assess).toHaveBeenCalledWith({
        sessionId: 's-1',
        datasetName: undefined,
      });
    });

    it("returns the bridge's error text as { error } and never throws", async () => {
      assess.mockRejectedValueOnce(
        new Error(
          'This session has several datasets: Lakehouse, Warehouse. Name the one to assess.',
        ),
      );

      const result = await run('assess_data_readiness', {});

      expect(result).toEqual({
        error:
          'This session has several datasets: Lakehouse, Warehouse. Name the one to assess.',
      });
      expect(readinessReportFromToolResult(result)).toBeUndefined();
      expect(modelSees('assess_data_readiness', result)).toEqual({
        type: 'json',
        value: result,
      });
    });
  });

  describe('get_readiness_report', () => {
    it('passes the report id and dataset through, and the model sees the summary', async () => {
      const result = await run('get_readiness_report', {
        reportId: 'rep-1',
        dataset: 'Warehouse',
      });

      expect(getReport).toHaveBeenCalledWith({
        sessionId: 's-1',
        reportId: 'rep-1',
        datasetName: 'Warehouse',
      });
      expect(readinessReportFromToolResult(result)).toBe(REPORT);
      expect(modelSees('get_readiness_report', result)).toEqual({
        type: 'json',
        value: SUMMARY,
      });
    });

    it('turns a thrown error into { error }', async () => {
      getReport.mockRejectedValueOnce(
        new Error(
          'Dataset "Nope" is not in this session. Choose one of: Lakehouse, Warehouse.',
        ),
      );
      await expect(
        run('get_readiness_report', { dataset: 'Nope' }),
      ).resolves.toEqual({
        error:
          'Dataset "Nope" is not in this session. Choose one of: Lakehouse, Warehouse.',
      });
    });
  });

  describe('list_readiness_reports', () => {
    it('returns the list as the model sees it', async () => {
      const result = await run('list_readiness_reports', {
        dataset: 'Warehouse',
      });

      expect(listReports).toHaveBeenCalledWith({
        sessionId: 's-1',
        datasetName: 'Warehouse',
      });
      expect(result).toEqual(LIST);
      expect(readinessReportFromToolResult(result)).toBeUndefined();
      expect(readinessModelOutput(result)).toBe(LIST);
    });

    it('turns a thrown error into { error }', async () => {
      listReports.mockRejectedValueOnce(new Error('boom'));
      await expect(run('list_readiness_reports', {})).resolves.toEqual({
        error: 'boom',
      });
    });
  });

  it('answer { error } with no session in context, without calling the bridge', async () => {
    for (const name of [
      'assess_data_readiness',
      'get_readiness_report',
      'list_readiness_reports',
    ] as const) {
      await expect(run(name, {}, contextWith(null))).resolves.toEqual({
        error: 'No session in context',
      });
    }
    // Nor with no requestContext at all.
    const execute = readinessTools.assess_data_readiness.execute as unknown as (
      input: unknown,
      context: unknown,
    ) => unknown;
    await expect(execute({}, {})).resolves.toEqual({
      error: 'No session in context',
    });
    expect(assess).not.toHaveBeenCalled();
    expect(getReport).not.toHaveBeenCalled();
    expect(listReports).not.toHaveBeenCalled();
  });
});

describe('readinessReportFromToolResult', () => {
  it('reads the report from a raw result and nothing else', () => {
    expect(
      readinessReportFromToolResult({ report: REPORT, summary: SUMMARY }),
    ).toBe(REPORT);
    expect(readinessReportFromToolResult(undefined)).toBeUndefined();
    expect(readinessReportFromToolResult(null)).toBeUndefined();
    expect(readinessReportFromToolResult('x')).toBeUndefined();
    expect(readinessReportFromToolResult({ error: 'x' })).toBeUndefined();
    expect(readinessReportFromToolResult(SUMMARY)).toBeUndefined();
    expect(readinessReportFromToolResult({ report: {} })).toBeUndefined();
  });
});
