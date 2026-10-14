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
import { CurrentUserService, LOCAL_USER } from '../auth/current-user.service';
import * as appSkills from '../../mastra/app-skills';

const SESSION = {
  id: 'session-1',
  name: 'Denials review',
  datasets: ['claims'],
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

/** Who the tests run as; nobody is signed in outside `runAs` (ADR-0012). */
const users = new CurrentUserService();

/** A test body run as Demo User, as a signed-in request would. */
const asDemoUser =
  <T>(fn: () => Promise<T>) =>
  (): Promise<T> =>
    users.runAs(LOCAL_USER, fn);

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
  const service = new DeepAnalysisService(
    sessions as never,
    mastra as never,
    users,
  );
  return { service, generate, filesystem, sessions, appended, users };
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
  it('keeps a job private to the user who started it, and runs it as them (admin R30, R32)', async () => {
    const { service, sessions, users } = build([
      PLAN,
      finding(1),
      finding(2),
      finding(3),
      REPORT,
    ]);
    const ada = { ...LOCAL_USER, id: 'ada' };
    const bob = { ...LOCAL_USER, id: 'bob' };
    const seenBy: (string | undefined)[] = [];
    sessions.backgroundAgentOptions.mockImplementation(() => {
      seenBy.push(users.current()?.id);
      return Promise.resolve({ maxSteps: 15, context: [], requestContext: {} });
    });

    const jobId = await users.runAs(ada, () => startJob(service));

    expect(() =>
      users.runAs(bob, () => service.status(SESSION.id, jobId)),
    ).toThrow('not found');
    // Demo User is scoped like anyone; outside a request nobody is signed in.
    expect(() =>
      users.runAs(LOCAL_USER, () => service.status(SESSION.id, jobId)),
    ).toThrow('not found');
    expect(() => service.status(SESSION.id, jobId)).toThrow('Sign in required');
    await users.runAs(ada, () => settle(service, jobId));
    expect(seenBy).toHaveLength(5);
    expect(new Set(seenBy)).toEqual(new Set(['ada']));
  });

  it(
    'plans, investigates each angle, writes the report and posts it to the chat',
    asDemoUser(async () => {
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
    }),
  );

  it(
    'keeps the job out of the session conversation memory',
    asDemoUser(async () => {
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
    }),
  );

  it(
    'reports progress per angle while investigating',
    asDemoUser(async () => {
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
    }),
  );

  it(
    'rejects a second job while one is running for the session',
    asDemoUser(async () => {
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
    }),
  );

  it(
    'records the failure in the chat when the pipeline breaks',
    asDemoUser(async () => {
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
    }),
  );

  it(
    'keeps an angle failure from losing the report',
    asDemoUser(async () => {
      const { service, generate, appended } = build([PLAN]);
      generate.mockRejectedValueOnce(new Error('warehouse timeout'));
      generate.mockResolvedValueOnce(finding(2));
      generate.mockResolvedValueOnce(finding(3));
      generate.mockResolvedValueOnce(REPORT);

      const jobId = await startJob(service);
      await settle(service, jobId);

      expect(service.status(SESSION.id, jobId).status).toBe('done');
      expect(appended[0].report?.angles).toBe(3);
    }),
  );

  it(
    'serves the stored markdown for download',
    asDemoUser(async () => {
      const { service, filesystem } = build([]);
      const result = await service.download(SESSION.id, 'job-1234abcd');
      expect(filesystem.readFile).toHaveBeenCalledWith(
        'reports/job-1234abcd.md',
        { encoding: 'utf-8' },
      );
      expect(result.markdown).toBe('# stored report');
      expect(result.filename.endsWith('.md')).toBe(true);
    }),
  );

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

// Golden prompts, captured from the service before the phase text moved into
// the deep-analysis skill (BA-202). The model must keep receiving exactly
// these strings, byte for byte.
const GOLDEN_PLAN =
  'Plan a deep analysis of the question below.\n' +
  'Produce between 3 and 5 investigation angles: distinct, answerable\n' +
  'sub-questions over the entities listed in the session context —\n' +
  'different dimensions, comparisons, time windows or drivers, never\n' +
  'restatements of one another.\n' +
  'Plan only: run no queries, ask no clarifying questions.\n' +
  '\n' +
  '<question>\n' +
  'Why are denials rising?\n' +
  '</question>';

const GOLDEN_ANGLE_1 =
  'Deep analysis — angle 1 of 3: By payer\n' +
  '\n' +
  'Investigate this angle with SQL over the session entities and\n' +
  'report what you found. This is one section of a longer report, so\n' +
  'stay on this angle.\n' +
  '\n' +
  '<overall-question>\n' +
  'Why are denials rising?\n' +
  '</overall-question>\n' +
  '\n' +
  '<angle>\n' +
  'Which payers deny most?\n' +
  '</angle>\n' +
  '\n' +
  'Rules:\n' +
  '- Run the queries yourself. Never ask the user anything and never\n' +
  '  call ask_clarification; when something is ambiguous pick the most\n' +
  '  reasonable reading and state the assumption.\n' +
  '- Do not create or update visuals.\n' +
  '- Report concrete numbers — values, counts, shares, deltas — and\n' +
  '  name the entities behind them. Flag anomalies you notice.\n' +
  '- Finish with a "SQL used" section listing every statement you ran,\n' +
  '  each in its own ```sql fenced block.';

const GOLDEN_ANGLE_2 =
  'Deep analysis — angle 2 of 3: By month\n' +
  '\n' +
  'Investigate this angle with SQL over the session entities and\n' +
  'report what you found. This is one section of a longer report, so\n' +
  'stay on this angle.\n' +
  '\n' +
  '<overall-question>\n' +
  'Why are denials rising?\n' +
  '</overall-question>\n' +
  '\n' +
  '<angle>\n' +
  'How did denials trend?\n' +
  '</angle>\n' +
  '\n' +
  'Rules:\n' +
  '- Run the queries yourself. Never ask the user anything and never\n' +
  '  call ask_clarification; when something is ambiguous pick the most\n' +
  '  reasonable reading and state the assumption.\n' +
  '- Do not create or update visuals.\n' +
  '- Report concrete numbers — values, counts, shares, deltas — and\n' +
  '  name the entities behind them. Flag anomalies you notice.\n' +
  '- Finish with a "SQL used" section listing every statement you ran,\n' +
  '  each in its own ```sql fenced block.';

const GOLDEN_ANGLE_3 =
  'Deep analysis — angle 3 of 3: By reason\n' +
  '\n' +
  'Investigate this angle with SQL over the session entities and\n' +
  'report what you found. This is one section of a longer report, so\n' +
  'stay on this angle.\n' +
  '\n' +
  '<overall-question>\n' +
  'Why are denials rising?\n' +
  '</overall-question>\n' +
  '\n' +
  '<angle>\n' +
  'Which reasons dominate?\n' +
  '</angle>\n' +
  '\n' +
  'Rules:\n' +
  '- Run the queries yourself. Never ask the user anything and never\n' +
  '  call ask_clarification; when something is ambiguous pick the most\n' +
  '  reasonable reading and state the assumption.\n' +
  '- Do not create or update visuals.\n' +
  '- Report concrete numbers — values, counts, shares, deltas — and\n' +
  '  name the entities behind them. Flag anomalies you notice.\n' +
  '- Finish with a "SQL used" section listing every statement you ran,\n' +
  '  each in its own ```sql fenced block.';

const GOLDEN_REPORT =
  'Write the deep-analysis report for the question below from the\n' +
  'investigation findings that follow. Use only what the findings\n' +
  'contain — never invent numbers.\n' +
  '\n' +
  'The body must start at "## Findings by angle" (one subsection per\n' +
  'angle, with its numbers), then "## Anomalies and drivers", then\n' +
  '"## Recommendations" (concrete next actions). Do not write an\n' +
  'executive summary or a data appendix in the body — those are added\n' +
  'around it.\n' +
  '\n' +
  '<question>\n' +
  'Why are denials rising?\n' +
  '</question>\n' +
  '\n' +
  '<findings>\n' +
  '### Angle 1: By payer\n' +
  'Which payers deny most?\n' +
  '\n' +
  'Angle 1: the rate is 10%.\n' +
  '\n' +
  'SQL used\n' +
  '\n' +
  '```sql\n' +
  'select 1\n' +
  '```\n' +
  '\n' +
  '### Angle 2: By month\n' +
  'How did denials trend?\n' +
  '\n' +
  'Angle 2: the rate is 20%.\n' +
  '\n' +
  'SQL used\n' +
  '\n' +
  '```sql\n' +
  'select 2\n' +
  '```\n' +
  '\n' +
  '### Angle 3: By reason\n' +
  'Which reasons dominate?\n' +
  '\n' +
  'Angle 3: the rate is 30%.\n' +
  '\n' +
  'SQL used\n' +
  '\n' +
  '```sql\n' +
  'select 3\n' +
  '```\n' +
  '</findings>';

const GOLDEN_TRICKY_PLAN =
  'Plan a deep analysis of the question below.\n' +
  'Produce between 3 and 5 investigation angles: distinct, answerable\n' +
  'sub-questions over the entities listed in the session context —\n' +
  'different dimensions, comparisons, time windows or drivers, never\n' +
  'restatements of one another.\n' +
  'Plan only: run no queries, ask no clarifying questions.\n' +
  '\n' +
  '<question>\n' +
  'Why $& rise? {{angleTitle}} $1\n' +
  '</question>';

const GOLDEN_TRICKY_ANGLE_1 =
  'Deep analysis — angle 1 of 3: By payer\n' +
  '\n' +
  'Investigate this angle with SQL over the session entities and\n' +
  'report what you found. This is one section of a longer report, so\n' +
  'stay on this angle.\n' +
  '\n' +
  '<overall-question>\n' +
  'Why $& rise? {{angleTitle}} $1\n' +
  '</overall-question>\n' +
  '\n' +
  '<angle>\n' +
  'Which payers deny most?\n' +
  '</angle>\n' +
  '\n' +
  'Rules:\n' +
  '- Run the queries yourself. Never ask the user anything and never\n' +
  '  call ask_clarification; when something is ambiguous pick the most\n' +
  '  reasonable reading and state the assumption.\n' +
  '- Do not create or update visuals.\n' +
  '- Report concrete numbers — values, counts, shares, deltas — and\n' +
  '  name the entities behind them. Flag anomalies you notice.\n' +
  '- Finish with a "SQL used" section listing every statement you ran,\n' +
  '  each in its own ```sql fenced block.';

/** Instruction text unique to each phase. */
const PHASE_MARKERS = {
  plan: [
    'Plan a deep analysis of the question below.',
    'Plan only: run no queries, ask no clarifying questions.',
  ],
  investigate: [
    'Investigate this angle with SQL over the session entities and',
    'Finish with a "SQL used" section listing every statement you ran,',
  ],
  report: [
    'Write the deep-analysis report for the question below from the',
    'The body must start at "## Findings by angle"',
  ],
};

function prompts(generate: jest.Mock): string[] {
  return generate.mock.calls.map((call: unknown[]) => call[0] as string);
}

describe('deep-analysis prompts', () => {
  afterEach(() => jest.restoreAllMocks());

  it(
    'sends the plan, each angle and the report byte-identical to the golden prompts',
    asDemoUser(async () => {
      const { service, generate } = build([
        PLAN,
        finding(1),
        finding(2),
        finding(3),
        REPORT,
      ]);

      await settle(service, await startJob(service));

      expect(prompts(generate)).toEqual([
        GOLDEN_PLAN,
        GOLDEN_ANGLE_1,
        GOLDEN_ANGLE_2,
        GOLDEN_ANGLE_3,
        GOLDEN_REPORT,
      ]);
    }),
  );

  it(
    'passes the question through verbatim, whatever characters it holds',
    asDemoUser(async () => {
      const { service, generate } = build([
        PLAN,
        finding(1),
        finding(2),
        finding(3),
        REPORT,
      ]);
      const question = 'Why $& rise? {{angleTitle}} $1';

      const started = await service.start(SESSION.id, question);
      await settle(service, (started as { jobId: string }).jobId);

      const sent = prompts(generate);
      expect(sent[0]).toBe(GOLDEN_TRICKY_PLAN);
      expect(sent[1]).toBe(GOLDEN_TRICKY_ANGLE_1);
      expect(sent[4]).toContain(`<question>\n${question}\n</question>`);
    }),
  );

  it(
    'loads one phase file per call and sends only that phase',
    asDemoUser(async () => {
      const read = jest.spyOn(appSkills, 'appSkillFile');
      const { service, generate } = build([
        PLAN,
        finding(1),
        finding(2),
        finding(3),
        REPORT,
      ]);

      await settle(service, await startJob(service));

      expect(read.mock.calls).toEqual([
        ['deep-analysis', 'phases/1-plan.md'],
        ['deep-analysis', 'phases/2-investigate.md'],
        ['deep-analysis', 'phases/2-investigate.md'],
        ['deep-analysis', 'phases/2-investigate.md'],
        ['deep-analysis', 'phases/3-report.md'],
      ]);
      const phases = [
        'plan',
        'investigate',
        'investigate',
        'investigate',
        'report',
      ] as const;
      prompts(generate).forEach((prompt, call) => {
        for (const [phase, markers] of Object.entries(PHASE_MARKERS)) {
          for (const marker of markers) {
            if (phase === phases[call]) expect(prompt).toContain(marker);
            else expect(prompt).not.toContain(marker);
          }
        }
        // The phase map itself never reaches the model.
        expect(prompt).not.toContain('phases/');
        expect(prompt).not.toContain('name: deep-analysis');
      });
    }),
  );

  it(
    'fails the job when a phase file leaves a placeholder unfilled',
    asDemoUser(async () => {
      jest
        .spyOn(appSkills, 'appSkillFile')
        .mockReturnValue('Plan {{question}} for {{audience}}\n');
      const { service, generate } = build([PLAN]);

      const jobId = await startJob(service);
      await settle(service, jobId);

      const view = service.status(SESSION.id, jobId);
      expect(view.status).toBe('error');
      expect(view.error).toContain('unfilled placeholder {{audience}}');
      expect(generate).not.toHaveBeenCalled();
    }),
  );

  it(
    'fails the job, rather than one angle, when the investigate phase is broken',
    asDemoUser(async () => {
      const real = appSkills.appSkillFile;
      jest
        .spyOn(appSkills, 'appSkillFile')
        .mockImplementation((name: string, path: string) =>
          path === 'phases/2-investigate.md'
            ? 'Angle {{angleTitle}} without the rest\n'
            : real(name, path),
        );
      const { service, generate, filesystem } = build([PLAN]);

      const jobId = await startJob(service);
      await settle(service, jobId);

      const view = service.status(SESSION.id, jobId);
      expect(view.status).toBe('error');
      expect(view.error).toMatch(
        /^deep-analysis phase phases\/2-investigate\.md has no \{\{\w+\}\} placeholder$/,
      );
      expect(generate).toHaveBeenCalledTimes(1);
      expect(filesystem.writeFile).not.toHaveBeenCalled();
    }),
  );
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
