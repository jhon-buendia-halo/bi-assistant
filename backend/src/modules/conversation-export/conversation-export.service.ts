import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR } from '../../infrastructure/database/database.module';
import {
  dashboardSlug,
  renderLiveDashboardBundle,
} from '../../mastra/workflows/live-dashboard';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { sandboxedVisualizationDocument } from '../sessions/visualization-document';
import type { WorkflowRunDoc } from '../workflows/workflow-run-steps';
import { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import type {
  ConversationExporter,
  ConversationExportFile,
  ConversationExportInput,
  ConversationExportRef,
  ConversationTurns,
  ExportFormat,
} from './conversation-export.contract';
import {
  ConversationExportsRepository,
  type ConversationExportDoc,
  type StoredExportFile,
} from './conversation-exports.repository';
import {
  EXPORT_PALETTES,
  dashboardVersionsNeeded,
  exportDocument,
  exportFooterHtml,
  exportHtml,
  exportSlides,
  type ExportDashboard,
  type ExportRun,
} from './export-document';
import {
  EXPORT_BROWSER_LAUNCHER,
  drawDeck,
  launchExportBrowser,
  pdfPageCount,
  type ExportBrowserLauncher,
} from './export-render';

/** The folder under the data directory that holds the exports' files. */
export const EXPORTS_DIR = 'exports';

/** Each format's content type, for the download (api.md 167). */
export const EXPORT_CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** The message when the conversation has nothing to export yet. */
export const NOTHING_TO_EXPORT_MESSAGE =
  'The conversation has no earlier answer to export yet.';

/**
 * The conversation export (agents.md 3.18; api.md 167; ADR-0056): reads the
 * conversation's runs before the asking one and their dashboards, draws the
 * dashboards and prints the report in the machine's browser, writes the
 * PowerPoint, and stores the files under `<data dir>/exports/<id>/` with a
 * `conversation_exports` document (data-model 3.20). One export at a time.
 */
@Injectable()
export class ConversationExportService implements ConversationExporter {
  private readonly logger = new Logger(ConversationExportService.name);
  /** The export under way: the next one waits for it. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly runs: WorkflowRunsRepository,
    private readonly artifacts: ArtifactsService,
    private readonly exports: ConversationExportsRepository,
    @Optional()
    @Inject(EXPORT_BROWSER_LAUNCHER)
    private readonly launch: ExportBrowserLauncher = launchExportBrowser,
  ) {}

  /**
   * The conversation's ended runs with an answer, oldest first, before
   * `beforeRunId` (all of them when that run is not in it).
   */
  private async earlierRuns(
    conversationId: string,
    beforeRunId: string,
  ): Promise<WorkflowRunDoc[]> {
    const runs = await this.runs.listConversation(conversationId);
    const current = runs.find((run) => run.id === beforeRunId);
    return runs
      .filter(
        (run) =>
          run.id !== beforeRunId &&
          (!current || run.startedAt < current.startedAt) &&
          run.status !== 'running' &&
          run.status !== 'suspended' &&
          !!run.question?.trim() &&
          !!run.answer?.content?.trim(),
      )
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async turns(
    conversationId: string,
    beforeRunId: string,
  ): Promise<ConversationTurns> {
    const runs = await this.earlierRuns(conversationId, beforeRunId);
    return {
      questions: runs.map((run) => run.question ?? ''),
      answers: runs.map((run) => run.answer?.content ?? ''),
    };
  }

  export(input: ConversationExportInput): Promise<ConversationExportRef> {
    const next = this.queue.then(
      () => this.make(input),
      () => this.make(input),
    );
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** One export: the files drawn, written and recorded. */
  private async make(
    input: ConversationExportInput,
  ): Promise<ConversationExportRef> {
    const stored = await this.earlierRuns(
      input.conversationId,
      input.beforeRunId,
    );
    if (!stored.length) throw new Error(NOTHING_TO_EXPORT_MESSAGE);
    const runs: ExportRun[] = stored.map((run) => ({
      id: run.id,
      question: run.question ?? '',
      startedAt: run.startedAt,
      answer: {
        content: run.answer?.content ?? '',
        ...(run.answer?.data ? { data: run.answer.data } : {}),
        ...(run.answer?.evidence ? { evidence: run.answer.evidence } : {}),
        ...(run.answer?.dashboard ? { dashboard: run.answer.dashboard } : {}),
      },
      datasets: run.datasets ?? [],
    }));
    const formats = [...new Set(input.content.formats)];
    const browser = await this.launch();
    const dashboards = new Map<string, ExportDashboard>();
    let pdf: Buffer | undefined;
    let doc: ReturnType<typeof exportDocument>;
    try {
      for (const need of dashboardVersionsNeeded(runs)) {
        const { artifactId, version } = need.ref;
        let detail: Awaited<ReturnType<ArtifactsService['detail']>>;
        try {
          detail = await this.artifacts.detail(artifactId, version);
        } catch (error) {
          // A dashboard deleted since: its turn keeps its answer alone.
          this.logger.warn(
            `Dashboard ${artifactId} v${version} is not exported: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        const { blueprint } = detail.artifact;
        const rows = await browser.captureDashboard(
          sandboxedVisualizationDocument(
            renderLiveDashboardBundle(blueprint, detail.rows),
          ),
          { firstRowOnly: !need.latest },
        );
        dashboards.set(need.runId, {
          ref: need.ref,
          latest: need.latest,
          ...(need.replacedBy !== undefined
            ? { replacedBy: need.replacedBy }
            : {}),
          ...(blueprint.summary ? { summary: blueprint.summary } : {}),
          filters: blueprint.filters.map((filter) => filter.label),
          status: detail.artifact.versions.find(
            (entry) => entry.version === version,
          )?.saved
            ? 'saved'
            : 'draft',
          rows,
        });
      }
      doc = exportDocument({
        runs,
        content: input.content,
        brand: input.brand,
        dashboards,
      });
      if (formats.includes('pdf')) {
        pdf = await browser.printPdf(exportHtml(doc), exportFooterHtml(doc));
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    const slides = formats.includes('pptx') ? exportSlides(doc) : undefined;
    const deck = slides
      ? await drawDeck(slides, {
          title: doc.title,
          palette: EXPORT_PALETTES[doc.brand],
        })
      : undefined;
    const id = randomUUID();
    const slug = dashboardSlug(input.content.title) || 'conversation';
    const folder = join(EXPORTS_DIR, id);
    await mkdir(join(DATA_DIR, folder), { recursive: true });
    const files: StoredExportFile[] = [];
    for (const format of formats) {
      const data = format === 'pdf' ? pdf : deck;
      if (!data) continue;
      const fileName = `${slug}.${format}`;
      const path = join(folder, fileName);
      await writeFile(join(DATA_DIR, path), data);
      files.push({
        format,
        fileName,
        bytes: data.length,
        ...(format === 'pdf' ? { pages: pdfPageCount(data) } : {}),
        ...(format === 'pptx' && slides ? { slides: slides.length } : {}),
        path,
      });
    }
    const record: ConversationExportDoc = {
      id,
      conversationId: input.conversationId,
      runId: input.beforeRunId,
      title: input.content.title,
      files,
      createdAt: new Date().toISOString(),
    };
    await this.exports.insert(record);
    return refOf(record);
  }

  /**
   * One file of an export, for its download (api.md 167): 400 for a format
   * that is neither `pdf` nor `pptx`, 404 for an unknown export or a format
   * it does not have.
   */
  async download(
    id: string,
    format: unknown,
  ): Promise<{ fileName: string; contentType: string; data: Buffer }> {
    if (format !== 'pdf' && format !== 'pptx') {
      throw new BadRequestException('format must be "pdf" or "pptx"');
    }
    const doc = await this.exports.get(id);
    if (!doc) throw new NotFoundException('Export not found');
    const file = doc.files.find((entry) => entry.format === format);
    if (!file) throw new NotFoundException(`This export has no ${format} file`);
    let data: Buffer;
    try {
      data = await readFile(join(DATA_DIR, file.path));
    } catch {
      throw new NotFoundException('The export file is gone');
    }
    return {
      fileName: file.fileName,
      contentType: EXPORT_CONTENT_TYPES[format],
      data,
    };
  }
}

/** The wire shape of a stored export: its files without their paths. */
export function refOf(doc: ConversationExportDoc): ConversationExportRef {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    files: doc.files.map((file): ConversationExportFile => ({
      format: file.format,
      fileName: file.fileName,
      bytes: file.bytes,
      ...(file.pages !== undefined ? { pages: file.pages } : {}),
      ...(file.slides !== undefined ? { slides: file.slides } : {}),
    })),
  };
}
