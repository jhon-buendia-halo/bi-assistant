jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));

import {
  DeepAnalysisService,
  extractSqlBlocks,
  reportMarkdown,
} from './deep-analysis.service';
import type { ChatMessage } from '../sessions/entities/session.entity';

const SESSION = {
  id: 'session-1',
  name: 'Denials review',
  sandboxes: ['claims'],
  messages: [],
};

const PLAN = {
  object: {
    title: 'Denial drivers',
    angles: [
      { title: 'By payer', question: 'Which payers deny most?' },
      { title: 'By month', question: 'How did denials trend?' },
      { title: 'By reason', question: 'Which reasons dominate?' },
    ],
  },
};

const REPORT = {
  object: {
    title: 'Denial drivers deep dive',
    executiveSummary: 'Denials rose to 12.4% driven by payer A.',
    report: '## Findings by angle\n\nPayer A denies 21% of claims.',
  },
};

function finding(n: number) {
  return {
    text: `Angle ${n}: the rate is ${n}0%.\n\nSQL used\n\n\`\`\`sql\nselect ${n}\n\`\`\``,
  };
}

/** A service wired to one job, with the agent and the workspace stubbed. */
function build(responses: unknown[], options: { plannerFails?: boolean } = {}) {
  const generate = jest.fn();
  for (const response of responses) {
    generate.mockResolvedValueOnce(response);
  }
  if (options.plannerFails) generate.mockRejectedValue(new Error('no model'));
  const filesystem = {
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('# stored report'),
  };
  const mastra = {
    getAgent: jest.fn().mockReturnValue({ generate }),
    ensureSessionWorkspace: jest
      .fn()
      .mockResolvedValue({ id: 'workspace-1', filesystem }),
  };
  const appended: Omit<ChatMessage, 'role' | 'at'>[] = [];
  const sessions = {
    get: jest.fn().mockResolvedValue({ ...SESSION }),
    backgroundAgentOptions: jest
      .fn()
      .mockResolvedValue({ maxSteps: 15, context: [], requestContext: {} }),
    appendAssistantMessage: jest
      .fn()
      .mockImplementation(async (_id: string, message: never) => {
        appended.push(message);
        return SESSION;
      }),
  };
  const service = new DeepAnalysisService(sessions as never, mastra as never);
  return { service, generate, filesystem, sessions, appended };
}

/** Let the in-process job run to completion (or failure). */
async function settle(
  service: DeepAnalysisService,
  jobId: string,
): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const { status } = service.status(SESSION.id, jobId);
    if (status === 'done' || status === 'error') return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('job never settled');
}

async function startJob(service: DeepAnalysisService): Promise<string> {
  const result = await service.start(SESSION.id, 'Why are denials rising?');
  if (!('jobId' in result)) throw new Error('job was rejected');
  return result.jobId;
}

describe('DeepAnalysisService', () => {
  it('plans, investigates each angle, writes the report and posts it to the chat', async () => {
    const { service, generate, filesystem, sessions, appended } = build([
      PLAN,
      finding(1),
      finding(2),
      finding(3),
      REPORT,
    ]);

    const jobId = await startJob(service);
    await settle(service, jobId);

    // One plan call, one per angle, one synthesis.
    expect(generate).toHaveBeenCalledTimes(5);
    expect(sessions.backgroundAgentOptions).toHaveBeenCalledTimes(5);

    const view = service.status(SESSION.id, jobId);
    expect(view.status).toBe('done');
    expect(view.steps).toBe(3);
    expect(view.title).toBe('Denial drivers deep dive');

    // Report persisted in the session workspace.
    const [path, markdown] = filesystem.writeFile.mock.calls[0] as [
      string,
      string,
    ];
    expect(path).toBe(`reports/${jobId}.md`);
    expect(markdown).toContain('# Denial drivers deep dive');
    expect(markdown).toContain('## Executive summary');
    expect(markdown).toContain('## Findings by angle');
    expect(markdown).toContain('## Data appendix');
    expect(markdown).toContain('select 2');

    // Chat message carries the summary and the report handle.
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual({
      content: 'Denials rose to 12.4% driven by payer A.',
      report: {
        jobId,
        title: 'Denial drivers deep dive',
        path: `reports/${jobId}.md`,
        angles: 3,
      },
    });
  });

  it('keeps the job out of the session conversation memory', async () => {
    const { service, generate } = build([
      PLAN,
      finding(1),
      finding(2),
      finding(3),
      REPORT,
    ]);

    await settle(service, await startJob(service));

    for (const call of generate.mock.calls) {
      expect(call[1]).not.toHaveProperty('memory');
    }
    // The tool-free steps run in one step; the angles get the full budget.
    expect(generate.mock.calls[0][1]).toEqual(
      expect.objectContaining({ maxSteps: 1, toolChoice: 'none' }),
    );
    expect(generate.mock.calls[1][1]).toEqual(
      expect.objectContaining({ maxSteps: 15 }),
    );
  });

  it('reports progress per angle while investigating', async () => {
    let releaseAngle: (value: unknown) => void = () => {};
    const held = new Promise((resolve) => {
      releaseAngle = resolve;
    });
    const { service, generate } = build([PLAN]);
    generate.mockImplementationOnce(async () => {
      await held;
      return finding(1);
    });
    generate.mockResolvedValue(REPORT);

    const jobId = await startJob(service);
    for (let i = 0; i < 20; i++) {
      if (service.status(SESSION.id, jobId).step === 1) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const view = service.status(SESSION.id, jobId);
    expect(view.status).toBe('investigating');
    expect(view.step).toBe(1);
    expect(view.steps).toBe(3);
    expect(view.progress).toContain('angle 1 of 3');

    releaseAngle(undefined);
    await settle(service, jobId);
  });

  it('rejects a second job while one is running for the session', async () => {
    let release: (value: unknown) => void = () => {};
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const { service, generate } = build([]);
    generate.mockImplementationOnce(async () => {
      await held;
      return PLAN;
    });
    generate.mockResolvedValue(REPORT);

    const first = await service.start(SESSION.id, 'Why are denials rising?');
    const second = await service.start(SESSION.id, 'Something else');
    expect(second).toEqual({
      conflictWith: (first as { jobId: string }).jobId,
    });

    release(undefined);
    await settle(service, (first as { jobId: string }).jobId);

    // Once it finished, the session can start another one.
    const third = await service.start(SESSION.id, 'Now what?');
    expect(third).toHaveProperty('jobId');
  });

  it('records the failure in the chat when the pipeline breaks', async () => {
    const { service, filesystem, appended } = build([], {
      plannerFails: true,
    });

    const jobId = await startJob(service);
    await settle(service, jobId);

    const view = service.status(SESSION.id, jobId);
    expect(view.status).toBe('error');
    expect(view.error).toContain('no model');
    expect(filesystem.writeFile).not.toHaveBeenCalled();
    expect(appended).toHaveLength(1);
    expect(appended[0].content).toContain('could not be completed');
    expect(appended[0].report).toBeUndefined();
  });

  it('keeps an angle failure from losing the report', async () => {
    const { service, generate, appended } = build([PLAN]);
    generate.mockRejectedValueOnce(new Error('warehouse timeout'));
    generate.mockResolvedValueOnce(finding(2));
    generate.mockResolvedValueOnce(finding(3));
    generate.mockResolvedValueOnce(REPORT);

    const jobId = await startJob(service);
    await settle(service, jobId);

    expect(service.status(SESSION.id, jobId).status).toBe('done');
    expect(appended[0].report?.angles).toBe(3);
  });

  it('serves the stored markdown for download', async () => {
    const { service, filesystem } = build([]);
    const result = await service.download(SESSION.id, 'job-1234abcd');
    expect(filesystem.readFile).toHaveBeenCalledWith(
      'reports/job-1234abcd.md',
      { encoding: 'utf-8' },
    );
    expect(result.markdown).toBe('# stored report');
    expect(result.filename.endsWith('.md')).toBe(true);
  });

  it('rejects a traversal attempt in the job id', async () => {
    const { service } = build([]);
    await expect(
      service.download(SESSION.id, '../../etc/passwd'),
    ).rejects.toThrow(/invalid deep analysis id/);
  });

  it('404s an unknown job', () => {
    const { service } = build([]);
    expect(() => service.status(SESSION.id, 'nope')).toThrow(/not found/);
  });
});

describe('report assembly', () => {
  it('collects the SQL the agent reported, de-duplicated', () => {
    expect(
      extractSqlBlocks(
        'text ```sql\nselect 1\n``` more ```sql\nselect 1\n``` ```sql\nselect 2\n```',
      ),
    ).toEqual(['select 1', 'select 2']);
  });

  it('builds the appendix from the findings, not from the model', () => {
    const markdown = reportMarkdown({
      title: 'T',
      question: 'Q',
      executiveSummary: 'S',
      body: '## Findings by angle',
      findings: [
        { title: 'A', question: 'qa', findings: 'f', sql: ['select 1'] },
        { title: 'B', question: 'qb', findings: 'f', sql: [] },
      ],
      sessionName: 'P',
      generatedAt: '2026-01-01T00:00:00.000Z',
      jobId: 'job-1',
    });
    expect(markdown).toContain('### 1. A');
    expect(markdown).toContain('select 1');
    expect(markdown).toContain('_No SQL was recorded for this angle._');
    expect(markdown).toContain('2 angles');
    expect(markdown).toContain('Report job-1');
  });
});
