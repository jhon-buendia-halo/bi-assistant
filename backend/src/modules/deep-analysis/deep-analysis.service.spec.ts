jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));

import {
  DeepAnalysisService,
  extractSqlBlocks,
  reportMarkdown,
} from './deep-analysis.service';
import {
  investigateAngle,
  planAnalysis,
  writeAnalysis,
  type DeepAnalysisCallDeps,
} from './deep-analysis.calls';
import type { AngleFinding } from '../../mastra/workflows/deep-analysis.steps';
import type { SessionDoc } from '../sessions/entities/session.entity';
import * as appSkills from '../../mastra/app-skills';

const SESSION = {
  id: 'session-1',
  name: 'Denials review',
  datasets: ['claims'],
  messages: [],
} as unknown as SessionDoc;

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

/** A test body, kept as a wrapper so the cases read as before. */
const asDemoUser =
  <T>(fn: () => Promise<T>) =>
  (): Promise<T> =>
    fn();

/** The assistant's calls with the agent and the workspace stubbed. */
function build(responses: unknown[]) {
  const generate = jest.fn<
    Promise<unknown>,
    [unknown, Record<string, unknown>?]
  >();
  for (const response of responses) {
    generate.mockResolvedValueOnce(response);
  }
  const filesystem = {
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('# Stored report\n\nBody'),
  };
  const mastra = {
    getAgent: jest.fn().mockReturnValue({ generate }),
    ensureSessionWorkspace: jest
      .fn()
      .mockResolvedValue({ id: 'workspace-1', filesystem }),
  };
  const sessions = {
    get: jest.fn().mockResolvedValue({ ...SESSION }),
    backgroundAgentOptions: jest
      .fn()
      .mockResolvedValue({ maxSteps: 15, context: [], requestContext: {} }),
  };
  const calls: DeepAnalysisCallDeps = {
    sessions: sessions,
    mastra: mastra,
    warn: jest.fn(),
  };
  const service = new DeepAnalysisService(sessions as never, mastra as never);
  return { service, calls, generate, filesystem, sessions };
}

/**
 * The three phases in order, as the `deep-analysis` run workflow sends them
 * (agents.md 5.15): the plan, one turn per angle, the report.
 */
async function pipeline(
  ctx: ReturnType<typeof build>,
  question = 'Why are denials rising?',
): Promise<void> {
  const plan = await planAnalysis(ctx.calls, SESSION, question);
  const findings: AngleFinding[] = [];
  for (const [index, angle] of plan.angles.entries()) {
    findings.push(
      await investigateAngle(
        ctx.calls,
        SESSION,
        question,
        angle,
        index,
        plan.angles.length,
      ),
    );
  }
  await writeAnalysis(ctx.calls, SESSION, question, findings);
}

describe('DeepAnalysisService (a past chat’s report)', () => {
  it('serves the stored markdown for download, named after its title', async () => {
    const { service, filesystem } = build([]);
    const result = await service.download(SESSION.id, 'job-1234abcd');
    expect(filesystem.readFile).toHaveBeenCalledWith(
      'reports/job-1234abcd.md',
      { encoding: 'utf-8' },
    );
    expect(result.markdown).toBe('# Stored report\n\nBody');
    expect(result.filename).toBe('stored-report.md');
  });

  it('rejects a traversal attempt in the job id', async () => {
    const { service } = build([]);
    await expect(
      service.download(SESSION.id, '../../etc/passwd'),
    ).rejects.toThrow(/invalid deep analysis id/);
  });

  it('404s a report that is not in the workspace', async () => {
    const { service, filesystem } = build([]);
    filesystem.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(service.download(SESSION.id, 'nope')).rejects.toThrow(
      /No deep analysis report/,
    );
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
      const ctx = build([PLAN, finding(1), finding(2), finding(3), REPORT]);

      await pipeline(ctx);

      expect(prompts(ctx.generate)).toEqual([
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
      const ctx = build([PLAN, finding(1), finding(2), finding(3), REPORT]);
      const question = 'Why $& rise? {{angleTitle}} $1';

      await pipeline(ctx, question);

      const sent = prompts(ctx.generate);
      expect(sent[0]).toBe(GOLDEN_TRICKY_PLAN);
      expect(sent[1]).toBe(GOLDEN_TRICKY_ANGLE_1);
      expect(sent[4]).toContain(`<question>\n${question}\n</question>`);
    }),
  );

  it(
    'loads one phase file per call and sends only that phase',
    asDemoUser(async () => {
      const read = jest.spyOn(appSkills, 'appSkillFile');
      const ctx = build([PLAN, finding(1), finding(2), finding(3), REPORT]);

      await pipeline(ctx);

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
      prompts(ctx.generate).forEach((prompt, call) => {
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
    'fails when a phase file leaves a placeholder unfilled',
    asDemoUser(async () => {
      jest
        .spyOn(appSkills, 'appSkillFile')
        .mockReturnValue('Plan {{question}} for {{audience}}\n');
      const ctx = build([PLAN]);

      await expect(pipeline(ctx)).rejects.toThrow(
        'unfilled placeholder {{audience}}',
      );
      expect(ctx.generate).not.toHaveBeenCalled();
    }),
  );

  it(
    'fails the analysis, rather than one angle, when the investigate phase is broken',
    asDemoUser(async () => {
      const real = appSkills.appSkillFile;
      jest
        .spyOn(appSkills, 'appSkillFile')
        .mockImplementation((name: string, path: string) =>
          path === 'phases/2-investigate.md'
            ? 'Angle {{angleTitle}} without the rest\n'
            : real(name, path),
        );
      const ctx = build([PLAN]);

      await expect(pipeline(ctx)).rejects.toThrow(
        /^deep-analysis phase phases\/2-investigate\.md has no \{\{\w+\}\} placeholder$/,
      );
      expect(ctx.generate).toHaveBeenCalledTimes(1);
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
