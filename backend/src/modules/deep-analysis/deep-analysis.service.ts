import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MastraService } from '../../mastra/mastra.service';
import { SessionsService } from '../sessions/sessions.service';
import type { SessionDoc } from '../sessions/entities/session.entity';
import {
  analysisPlanSchema,
  analysisReportSchema,
  type AnalysisPlan,
  type AnalysisReportOutput,
} from './deep-analysis.schemas';
import {
  AnalysisAngle,
  AngleFinding,
  DeepAnalysisJob,
  DeepAnalysisView,
} from './entities/deep-analysis-job.entity';

type WorkspaceFilesystem = NonNullable<
  Awaited<ReturnType<MastraService['ensureSessionWorkspace']>>['filesystem']
>;

/** Directory reports live in, inside the session's Mastra workspace. */
const REPORTS_DIR = 'reports';
/** Hard ceiling on the plan, whatever the model proposes. */
const MAX_ANGLES = 5;
/** Findings are prose; this keeps one runaway angle from eating the synthesis. */
const FINDINGS_CHARS_CAP = 12_000;
/** Finished jobs kept for polling/late status reads before pruning. */
const RETAINED_JOBS = 50;

@Injectable()
export class DeepAnalysisService implements OnModuleDestroy {
  private readonly logger = new Logger(DeepAnalysisService.name);
  /** Every job this process has seen, by job id. */
  private readonly jobs = new Map<string, DeepAnalysisJob>();
  /** One running job per session — the guard behind `ok: false`. */
  private readonly running = new Map<string, string>();
  private readonly aborts = new Map<string, AbortController>();

  constructor(
    private readonly sessions: SessionsService,
    private readonly mastra: MastraService,
  ) {}

  onModuleDestroy(): void {
    for (const controller of this.aborts.values()) controller.abort();
  }

  /**
   * Start a job. Returns its id immediately; the pipeline runs in-process and
   * reports through `status`, then through a chat message when it finishes.
   */
  async start(
    sessionId: string,
    question: string,
  ): Promise<{ jobId: string } | { conflictWith: string }> {
    const trimmed = (question ?? '').trim();
    if (!trimmed) throw new BadRequestException('question is required');
    // Throws 404 for an unknown session before anything is scheduled.
    const session = await this.sessions.get(sessionId);

    const existing = this.running.get(sessionId);
    if (existing) return { conflictWith: existing };

    const job: DeepAnalysisJob = {
      id: randomUUID(),
      sessionId,
      question: trimmed,
      status: 'planning',
      progress: 'Planning the investigation',
      startedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.running.set(sessionId, job.id);
    this.prune();

    const abort = new AbortController();
    this.aborts.set(job.id, abort);
    // Deliberately not awaited: the HTTP call returns while the job runs.
    void this.run(job, session, abort.signal).finally(() => {
      this.running.delete(sessionId);
      this.aborts.delete(job.id);
      job.finishedAt = new Date().toISOString();
    });
    return { jobId: job.id };
  }

  /** Poll one job. */
  status(sessionId: string, jobId: string): DeepAnalysisView {
    const job = this.jobs.get(jobId);
    if (!job || job.sessionId !== sessionId) {
      throw new NotFoundException(`Deep analysis ${jobId} not found`);
    }
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      step: job.step,
      steps: job.steps,
      title: job.title,
      error: job.error,
    };
  }

  /**
   * The stored markdown. Read straight from the workspace by job id rather
   * than from the in-memory job, so a report stays downloadable after the
   * backend restarts.
   */
  async download(
    sessionId: string,
    jobId: string,
  ): Promise<{ filename: string; markdown: string }> {
    if (!/^[a-zA-Z0-9-]+$/.test(jobId)) {
      throw new BadRequestException('invalid deep analysis id');
    }
    const session = await this.sessions.get(sessionId);
    const filesystem = await this.filesystemFor(session);
    let markdown: string;
    try {
      const value = await filesystem.readFile(reportPath(jobId), {
        encoding: 'utf-8',
      });
      markdown = Buffer.isBuffer(value)
        ? value.toString('utf8')
        : String(value);
    } catch {
      throw new NotFoundException(`No deep analysis report for ${jobId}`);
    }
    const title = this.jobs.get(jobId)?.title;
    return {
      filename: `${slug(title) || `deep-analysis-${jobId.slice(0, 8)}`}.md`,
      markdown,
    };
  }

  // ---------------------------------------------------------------- pipeline

  private async run(
    job: DeepAnalysisJob,
    session: SessionDoc,
    abortSignal: AbortSignal,
  ): Promise<void> {
    try {
      const plan = await this.plan(session, job.question, abortSignal);
      const angles = plan.angles.slice(0, MAX_ANGLES);
      if (!angles.length) throw new Error('the planner returned no angles');
      job.title = plan.title.trim() || job.question.slice(0, 80);
      job.steps = angles.length;
      job.status = 'investigating';

      const findings: AngleFinding[] = [];
      for (const [index, angle] of angles.entries()) {
        if (abortSignal.aborted) return;
        job.step = index + 1;
        job.progress = `Investigating angle ${index + 1} of ${angles.length}: ${angle.title}`;
        findings.push(
          await this.investigate(
            session,
            job.question,
            angle,
            index,
            angles.length,
            abortSignal,
          ),
        );
      }

      if (abortSignal.aborted) return;
      job.status = 'writing';
      job.step = angles.length;
      job.progress = 'Writing the report';
      const written = await this.synthesize(
        session,
        job.question,
        findings,
        abortSignal,
      );
      job.title = written.title.trim() || job.title;

      const generatedAt = new Date().toISOString();
      const markdown = reportMarkdown({
        title: job.title,
        question: job.question,
        executiveSummary: written.executiveSummary.trim(),
        body: written.report.trim(),
        findings,
        sessionName: session.name,
        generatedAt,
        jobId: job.id,
      });
      const filesystem = await this.filesystemFor(session);
      await filesystem.writeFile(reportPath(job.id), markdown);
      job.path = reportPath(job.id);

      await this.sessions.appendAssistantMessage(session.id, {
        content: written.executiveSummary.trim(),
        report: {
          jobId: job.id,
          title: job.title,
          path: job.path,
          angles: findings.length,
        },
      });
      job.status = 'done';
      job.progress = `Report ready — ${findings.length} angle${findings.length === 1 ? '' : 's'} investigated`;
    } catch (error) {
      if (abortSignal.aborted) return;
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Deep analysis ${job.id} failed: ${detail}`);
      job.status = 'error';
      job.error = detail;
      job.progress = 'Deep analysis failed';
      try {
        await this.sessions.appendAssistantMessage(session.id, {
          content: `Deep analysis of "${job.question}" could not be completed — ${detail}`,
        });
      } catch (append: unknown) {
        this.logger.warn(
          `Could not record the deep analysis failure: ${
            append instanceof Error ? append.message : String(append)
          }`,
        );
      }
    }
  }

  /** Step 1: 3-5 distinct angles, one structured call, no tools. */
  private async plan(
    session: SessionDoc,
    question: string,
    abortSignal: AbortSignal,
  ): Promise<AnalysisPlan> {
    const options = await this.sessions.backgroundAgentOptions(
      session,
      question,
      abortSignal,
    );
    const generated = await this.mastra
      .getAgent('assistant')
      .generate(
        [
          'Plan a deep analysis of the question below.',
          'Produce between 3 and 5 investigation angles: distinct, answerable',
          'sub-questions over the entities listed in the session context —',
          'different dimensions, comparisons, time windows or drivers, never',
          'restatements of one another.',
          'Plan only: run no queries, ask no clarifying questions.',
          '',
          '<question>',
          question,
          '</question>',
        ].join('\n'),
        {
          ...options,
          maxSteps: 1,
          toolChoice: 'none',
          structuredOutput: {
            schema: analysisPlanSchema,
            jsonPromptInjection: 'inline' as const,
          },
        },
      );
    const parsed = analysisPlanSchema.safeParse(
      generated.object ?? parseJsonObject(generated.text),
    );
    if (!parsed.success) {
      throw new Error('the planner returned no usable investigation plan');
    }
    return parsed.data;
  }

  /** Step 2: one tool-enabled turn per angle, sequential. */
  private async investigate(
    session: SessionDoc,
    question: string,
    angle: AnalysisAngle,
    index: number,
    total: number,
    abortSignal: AbortSignal,
  ): Promise<AngleFinding> {
    const options = await this.sessions.backgroundAgentOptions(
      session,
      angle.question,
      abortSignal,
    );
    try {
      const result = await this.mastra
        .getAgent('assistant')
        .generate(
          [
            `Deep analysis — angle ${index + 1} of ${total}: ${angle.title}`,
            '',
            'Investigate this angle with query_entities over the session',
            'entities and report what you found. This is one section of a',
            'longer report, so stay on this angle.',
            '',
            '<overall-question>',
            question,
            '</overall-question>',
            '',
            '<angle>',
            angle.question,
            '</angle>',
            '',
            'Rules:',
            '- Run the queries yourself with query_entities. Never ask the',
            '  user anything and never call ask_clarification; when something',
            '  is ambiguous pick the most reasonable reading and state the',
            '  assumption.',
            '- Do not create or update visuals.',
            '- Report concrete numbers — values, counts, shares, deltas — and',
            '  name the entities behind them. Flag anomalies you notice.',
            '- Finish with an "Entities and metrics used" section listing the',
            '  entities and metrics you queried. If query_entities could not',
            '  express part of this angle and you fell back to run_raw_sql,',
            '  also include that statement in its own ```sql fenced block.',
          ].join('\n'),
          { ...options, maxSteps: 15 },
        );
      const text = (result.text ?? '').trim();
      return {
        ...angle,
        findings: text.slice(0, FINDINGS_CHARS_CAP) || 'No findings returned.',
        sql: extractSqlBlocks(text),
      };
    } catch (error) {
      if (abortSignal.aborted) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Deep analysis angle "${angle.title}" failed: ${detail}`,
      );
      // One failed angle must not lose the rest of the report.
      return {
        ...angle,
        findings: `This angle could not be investigated — ${detail}`,
        sql: [],
      };
    }
  }

  /** Step 3: one structured, tool-free call that writes the report. */
  private async synthesize(
    session: SessionDoc,
    question: string,
    findings: AngleFinding[],
    abortSignal: AbortSignal,
  ): Promise<AnalysisReportOutput> {
    const options = await this.sessions.backgroundAgentOptions(
      session,
      question,
      abortSignal,
    );
    const result = await this.mastra
      .getAgent('assistant')
      .generate(
        [
          'Write the deep-analysis report for the question below from the',
          'investigation findings that follow. Use only what the findings',
          'contain — never invent numbers.',
          '',
          'The body must start at "## Findings by angle" (one subsection per',
          'angle, with its numbers), then "## Anomalies and drivers", then',
          '"## Recommendations" (concrete next actions). Do not write an',
          'executive summary or a data appendix in the body — those are added',
          'around it.',
          '',
          '<question>',
          question,
          '</question>',
          '',
          '<findings>',
          findings
            .map((finding, index) =>
              [
                `### Angle ${index + 1}: ${finding.title}`,
                finding.question,
                '',
                finding.findings,
              ].join('\n'),
            )
            .join('\n\n'),
          '</findings>',
        ].join('\n'),
        {
          ...options,
          maxSteps: 1,
          toolChoice: 'none',
          structuredOutput: {
            schema: analysisReportSchema,
            jsonPromptInjection: 'inline' as const,
          },
        },
      );
    const parsed = analysisReportSchema.safeParse(
      result.object ?? parseJsonObject(result.text),
    );
    if (!parsed.success) {
      throw new Error('the report writer returned no usable report');
    }
    return parsed.data;
  }

  private async filesystemFor(
    session: SessionDoc,
  ): Promise<WorkspaceFilesystem> {
    const workspace = await this.mastra.ensureSessionWorkspace(
      session.id,
      session.name,
    );
    const filesystem = workspace.filesystem;
    if (!filesystem) throw new Error('session workspace has no filesystem');
    return filesystem;
  }

  /** Keep the in-memory history bounded; running jobs are never dropped. */
  private prune(): void {
    if (this.jobs.size <= RETAINED_JOBS) return;
    const finished = [...this.jobs.values()]
      .filter((job) => this.running.get(job.sessionId) !== job.id)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const job of finished.slice(0, this.jobs.size - RETAINED_JOBS)) {
      this.jobs.delete(job.id);
    }
  }
}

export function reportPath(jobId: string): string {
  return `${REPORTS_DIR}/${jobId}.md`;
}

/** Every ```sql fenced statement in the agent's findings, de-duplicated. */
export function extractSqlBlocks(text: string): string[] {
  const blocks = [...text.matchAll(/```sql\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return [...new Set(blocks)];
}

/**
 * The stored report. Title, question, executive summary, the written body and
 * the data appendix are assembled here rather than by the model, so the
 * document's structure — and the SQL it claims to be based on — cannot drift.
 */
export function reportMarkdown(input: {
  title: string;
  question: string;
  executiveSummary: string;
  body: string;
  findings: AngleFinding[];
  sessionName?: string;
  generatedAt: string;
  jobId: string;
}): string {
  const lines = [
    `# ${input.title}`,
    '',
    `**Question:** ${input.question}`,
    '',
    [
      'Deep analysis',
      input.sessionName ? `session: ${input.sessionName}` : '',
      `${input.findings.length} angle${input.findings.length === 1 ? '' : 's'}`,
      `generated ${input.generatedAt}`,
    ]
      .filter(Boolean)
      .join(' · '),
    '',
    '## Executive summary',
    '',
    input.executiveSummary,
    '',
    input.body,
    '',
    '## Data appendix',
    '',
  ];
  input.findings.forEach((finding, index) => {
    lines.push(`### ${index + 1}. ${finding.title}`, '', finding.question, '');
    if (finding.sql.length) {
      for (const sql of finding.sql) lines.push('```sql', sql, '```', '');
    } else {
      lines.push('_No SQL was recorded for this angle._', '');
    }
  });
  lines.push('---', '', `Report ${input.jobId}`, '');
  return lines.join('\n');
}

function slug(title: string | undefined): string {
  return (title ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

/** Parse a model's JSON reply, tolerating a markdown fence around it. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}
