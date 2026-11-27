import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MastraService } from '../../mastra/mastra.service';
import { getDatasetToolServices } from '../../mastra/tool-services';
import {
  ChartDataRecord,
  FRAME_SCRIPT_FILENAME,
  FRAME_SELECT_SCRIPT,
  InteractiveVisualBundle,
  sandboxedVisualizationDocument,
  storedVisualizationDocument,
  VisualContext,
} from './visualization-document';
import {
  SPEC_BODY_HTML,
  SPEC_BOOTSTRAP_SCRIPT,
  SPEC_FILENAME,
  visualSpecSchema,
  type VisualSpec,
} from './visual-spec';
import {
  VISUAL_RUNTIME_FILENAME,
  VISUAL_RUNTIME_SCRIPT,
} from './visual-runtime';
import { createZip } from './zip-archive';
import {
  ChatMessage,
  InteractiveVisualization,
  SessionDoc,
  SessionVisualization,
  ReasoningStep,
  ToolDataRecord,
} from './entities/session.entity';

/**
 * What a version renders from. Spec visuals carry `spec` and keep synthetic
 * html/css/javascript so every existing reader (download, body.html, the
 * document builders) keeps working through one shape.
 */
type Bundle = InteractiveVisualBundle;

type WorkspaceFilesystem = NonNullable<
  Awaited<ReturnType<MastraService['ensureSessionWorkspace']>>['filesystem']
>;

/**
 * How many successful result sets a visual keeps: the ones the prompt shows
 * and the runtime draws are the same, in the same order.
 */
const VISUAL_RECORDS_CAP = 8;
/** Size of the data embedded in the frame for the runtime, in characters. */
const RENDER_DATA_CHARS_CAP = 400_000;
/** The size guard on the embedded data never cuts a result set below this. */
const RENDER_MIN_ROWS_PER_RECORD = 20;
/** Rows kept per re-run record, same cap the transcript applies at capture time. */
const REFRESH_STORED_ROWS_CAP = 200;
/** Max rows requested per re-run — the query tool's own ceiling. */
const REFRESH_ROW_LIMIT = 500;

/**
 * Loads, versions (revert, refresh) and packages the interactive visuals a
 * session stored in its Mastra workspace (`visuals/<id>/v<N>/`). The visual
 * designer that made them is gone (ADR-0059): no new visual is designed.
 */
@Injectable()
export class VisualizationService {
  private readonly logger = new Logger(VisualizationService.name);

  constructor(private readonly mastra: MastraService) {}

  currentVersion(meta: SessionVisualization): number {
    return meta.currentVersion ?? 1;
  }

  /** Version directory; legacy single-version visuals keep files at the root. */
  versionPath(meta: SessionVisualization, version: number): string {
    if (!meta.versions?.length && version <= 1) return meta.path;
    return `${meta.path}/v${version}`;
  }

  /**
   * Resolve where a version's files actually live. Visuals created before
   * versioning keep v1 at the root even after later versions gain `v<N>/`.
   */
  private async resolveVersionDir(
    filesystem: WorkspaceFilesystem,
    meta: SessionVisualization,
    version: number,
  ): Promise<string> {
    const dir = this.versionPath(meta, version);
    if (version !== 1 || dir === meta.path) return dir;
    try {
      await filesystem.readFile(`${dir}/index.html`);
      return dir;
    } catch {
      return meta.path;
    }
  }

  find(session: SessionDoc, visualId: string): SessionVisualization {
    const meta = (session.visualizations ?? []).find((v) => v.id === visualId);
    if (!meta) {
      throw new NotFoundException(
        `Visualization ${visualId} not found in session ${session.id}`,
      );
    }
    return meta;
  }

  /** Point the visual at an earlier version (no files change). */
  async revert(
    session: SessionDoc,
    visualId: string,
    version: number,
  ): Promise<SessionVisualization> {
    const meta = this.find(session, visualId);
    const known = meta.versions?.some((v) => v.version === version);
    if (!known && !(version === 1 && !meta.versions?.length)) {
      throw new BadRequestException(`Version ${version} does not exist`);
    }
    const { filesystem } = await this.workspaceFor(session);
    const bundle = await this.readBundle(filesystem, meta, version);
    return {
      ...meta,
      title: bundle.title,
      description: bundle.description,
      currentVersion: version,
    };
  }

  /** Assemble the sandboxed document for the panel. */
  async load(
    session: SessionDoc,
    visualId: string,
    version?: number,
  ): Promise<InteractiveVisualization> {
    const meta = this.find(session, visualId);
    const target = version ?? this.currentVersion(meta);
    const { filesystem } = await this.workspaceFor(session);
    const bundle = await this.readBundle(filesystem, meta, target);
    return {
      ...meta,
      title: bundle.title,
      description: bundle.description,
      version: target,
      document: sandboxedVisualizationDocument(
        bundle,
        await this.contextFor(filesystem, session, meta, target),
      ),
    };
  }

  /** Portable HTML/CSS/JS zip of one version. */
  async download(
    session: SessionDoc,
    visualId: string,
    version?: number,
  ): Promise<{ filename: string; archive: Buffer }> {
    const meta = this.find(session, visualId);
    const target = version ?? this.currentVersion(meta);
    const { filesystem } = await this.workspaceFor(session);
    const bundle = await this.readBundle(filesystem, meta, target);
    const context = await this.contextFor(filesystem, session, meta, target);
    // Always assemble index.html from the bundle so legacy versions also ship
    // with the readable frame (question, takeaway, analysis, data) — and, as
    // of the inlined-script document, render on their own when a reader opens
    // index.html straight out of the zip without extracting its siblings.
    const html = storedVisualizationDocument(bundle, context);
    const css = bundle.css;
    const javascript = bundle.javascript;
    const extras = [
      // index.html carries the runtime inline; the spec and the runtime file
      // ship alongside it as the readable, editable source of the chart.
      ...(bundle.spec
        ? [
            {
              name: SPEC_FILENAME,
              data: JSON.stringify(bundle.spec, null, 2),
            },
            { name: VISUAL_RUNTIME_FILENAME, data: VISUAL_RUNTIME_SCRIPT },
          ]
        : []),
      ...(context.answer
        ? [{ name: 'answer.md', data: answerMarkdown(bundle, context) }]
        : []),
      ...(context.data?.length
        ? [{ name: 'data.json', data: JSON.stringify(context.data, null, 2) }]
        : []),
    ];
    const slug = meta.title
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 64);
    return {
      filename: `${slug || `visual-${meta.id.slice(0, 8)}`}-v${target}.zip`,
      archive: createZip(
        [
          { name: 'index.html', data: html },
          { name: 'styles.css', data: css },
          // Always regenerated, so versions written before the bridge existed
          // still download with a complete, self-consistent document.
          { name: FRAME_SCRIPT_FILENAME, data: FRAME_SELECT_SCRIPT },
          { name: 'script.js', data: javascript },
          ...extras,
        ],
        new Date(meta.createdAt),
      ),
    };
  }

  // ---------------------------------------------------------------- internals

  private findSourceAnswer(
    session: SessionDoc,
    sourceMessageAt: string | undefined,
  ): ChatMessage {
    const candidates = session.messages.filter(
      (m) =>
        m.role === 'assistant' && !m.clarification && m.content.trim().length,
    );
    const answer = sourceMessageAt
      ? candidates.find((m) => m.at === sourceMessageAt)
      : candidates.at(-1);
    if (!answer) {
      throw new BadRequestException('completed assistant answer not found');
    }
    return answer;
  }

  private findQuestion(
    session: SessionDoc,
    answer: ChatMessage,
  ): ChatMessage | undefined {
    const index = session.messages.indexOf(answer);
    return session.messages
      .slice(0, index < 0 ? undefined : index)
      .reverse()
      .find((m) => m.role === 'user');
  }

  private async workspaceFor(session: SessionDoc) {
    const workspace = await this.mastra.ensureSessionWorkspace(
      session.id,
      session.name,
    );
    const filesystem = workspace.filesystem;
    if (!filesystem) throw new Error('session workspace has no filesystem');
    return { workspace, filesystem };
  }

  /**
   * The analysis behind a visual, resolved from the session transcript. When
   * the version directory carries a `data.json` (written by `writeVersion` or
   * a later `refreshData`), it wins over the source answer's captured data —
   * a refresh must show up in the frame's provenance and in `window.qti.data`
   * without needing a new version.
   */
  private async contextFor(
    filesystem: WorkspaceFilesystem,
    session: SessionDoc,
    meta: SessionVisualization,
    version: number,
    generatedAt?: string,
    overrideData?: ToolDataRecord[],
  ): Promise<VisualContext> {
    const answer = session.messages.find(
      (m) => m.role === 'assistant' && m.at === meta.sourceMessageAt,
    );
    const question = answer ? this.findQuestion(session, answer) : undefined;
    const entry = meta.versions?.find((v) => v.version === version);
    const data =
      overrideData ??
      (await this.readVersionData(filesystem, meta, version)) ??
      answer?.data;
    // The same result sets the spec was validated against, with every stored
    // row: the injected window.qti.data is what the visual draws.
    const drawn = frameData(data);
    // Older transcripts predate the persisted `reasoning` field: fall back to
    // deriving it from the rationale each tool call already carried. Always
    // from the source answer's records — the trail explains how the answer
    // was reached, not the latest refreshed rows.
    const reasoning = answer?.reasoning?.length
      ? answer.reasoning
      : deriveReasoning(answer?.data);
    return {
      question: question?.content,
      answer: answer?.content,
      data,
      chartData: drawn.chartData,
      entities: answer?.entities,
      ...(reasoning.length ? { reasoning } : {}),
      sessionName: session.name,
      version,
      generatedAt:
        generatedAt ?? entry?.refreshedAt ?? entry?.createdAt ?? meta.createdAt,
      ...(drawn.chartRows ? { chartRows: drawn.chartRows } : {}),
    };
  }

  /** Version's stored data.json, when one has been written; undefined otherwise. */
  private async readVersionData(
    filesystem: WorkspaceFilesystem,
    meta: SessionVisualization,
    version: number,
  ): Promise<ToolDataRecord[] | undefined> {
    try {
      const dir = await this.resolveVersionDir(filesystem, meta, version);
      const parsed: unknown = JSON.parse(
        await this.readText(filesystem, `${dir}/data.json`),
      );
      return Array.isArray(parsed) ? (parsed as ToolDataRecord[]) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Re-run the SQL behind the current version's stored data and refresh it in
   * place: same version, same bundle, only `data.json` and `index.html`
   * change. Records without a `run_readonly_sql` statement (or already
   * failed) keep their existing rows; a query that fails to re-run stores its
   * error instead of aborting the rest.
   */
  async refreshData(
    session: SessionDoc,
    visualId: string,
  ): Promise<{ metadata: SessionVisualization; bundle: Bundle }> {
    const meta = this.find(session, visualId);
    const version = this.currentVersion(meta);
    const { filesystem } = await this.workspaceFor(session);
    const dir = await this.resolveVersionDir(filesystem, meta, version);
    const answer = session.messages.find(
      (m) => m.role === 'assistant' && m.at === meta.sourceMessageAt,
    );
    const existing =
      (await this.readVersionData(filesystem, meta, version)) ??
      answer?.data ??
      [];

    const datasets = await getDatasetToolServices().getDatasets(
      session.datasets,
    );
    const datasourceIds = new Set(
      datasets
        .map((s) => s.datasourceId)
        .filter((value): value is string => !!value),
    );
    const datasourceError =
      datasourceIds.size === 0
        ? "No datasource is bound to this session's datasets"
        : datasourceIds.size > 1
          ? 'Several datasources are in scope for this session; refresh is not supported'
          : undefined;
    const datasourceId = datasourceError
      ? undefined
      : Array.from(datasourceIds)[0];

    const refreshed = await Promise.all(
      existing.map(async (record): Promise<ToolDataRecord> => {
        if (
          record.tool !== 'run_readonly_sql' ||
          record.error ||
          !record.input?.trim()
        ) {
          return record;
        }
        if (!datasourceId) {
          return {
            tool: record.tool,
            input: record.input,
            ...(record.rationale ? { rationale: record.rationale } : {}),
            error: datasourceError ?? 'unable to resolve a datasource',
          };
        }
        try {
          const result = await getDatasetToolServices().runReadOnlySql(
            datasourceId,
            record.input,
            REFRESH_ROW_LIMIT,
            session.datasets,
          );
          const rows = result.rows ?? [];
          const columns = result.columns?.length
            ? result.columns
            : Object.keys(rows[0] ?? {});
          const truncated =
            result.truncated === true || rows.length > REFRESH_STORED_ROWS_CAP;
          return {
            tool: record.tool,
            input: result.correctedSql ?? record.input,
            // The rationale explains why the query ran; a refresh re-runs the
            // same query, so the explanation carries over unchanged.
            ...(record.rationale ? { rationale: record.rationale } : {}),
            columns,
            rows: rows.slice(0, REFRESH_STORED_ROWS_CAP),
            rowCount: rows.length,
            ...(truncated ? { truncated: true } : {}),
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(`Refresh failed for a query: ${message}`);
          return {
            tool: record.tool,
            input: record.input,
            ...(record.rationale ? { rationale: record.rationale } : {}),
            error: message,
          };
        }
      }),
    );

    const bundle = await this.readBundle(filesystem, meta, version);
    const question = answer ? this.findQuestion(session, answer) : undefined;
    const generatedAt = new Date().toISOString();
    const drawn = frameData(refreshed);
    // Same fallback as contextFor: the reasoning trail explains how the answer
    // was reached, so the regenerated document keeps it after a refresh.
    const reasoning = answer?.reasoning?.length
      ? answer.reasoning
      : deriveReasoning(answer?.data);
    const context: VisualContext = {
      question: question?.content,
      answer: answer?.content,
      data: refreshed,
      chartData: drawn.chartData,
      entities: answer?.entities,
      ...(reasoning.length ? { reasoning } : {}),
      sessionName: session.name,
      version,
      generatedAt,
      ...(drawn.chartRows ? { chartRows: drawn.chartRows } : {}),
    };

    await Promise.all([
      filesystem.writeFile(
        `${dir}/data.json`,
        JSON.stringify(refreshed, null, 2),
      ),
      filesystem.writeFile(
        `${dir}/index.html`,
        storedVisualizationDocument(bundle, context),
      ),
    ]);

    const history = meta.versions?.length
      ? meta.versions
      : [
          {
            version: 1,
            createdAt: meta.createdAt,
            sourceMessageAt: meta.sourceMessageAt,
          },
        ];
    const metadata: SessionVisualization = {
      ...meta,
      versions: history.map((v) =>
        v.version === version ? { ...v, refreshedAt: generatedAt } : v,
      ),
    };
    return { metadata, bundle };
  }

  private async writeVersion(
    filesystem: WorkspaceFilesystem,
    dir: string,
    bundle: Bundle,
    metadata: SessionVisualization,
    version: number,
    context: VisualContext,
  ): Promise<void> {
    await Promise.all([
      filesystem.writeFile(
        `${dir}/index.html`,
        storedVisualizationDocument(bundle, context),
      ),
      ...(context.answer
        ? [
            filesystem.writeFile(
              `${dir}/answer.md`,
              answerMarkdown(bundle, context),
            ),
          ]
        : []),
      ...(context.data?.length
        ? [
            filesystem.writeFile(
              `${dir}/data.json`,
              JSON.stringify(context.data, null, 2),
            ),
          ]
        : []),
      // Body fragment stored on its own so loading never re-parses index.html.
      filesystem.writeFile(`${dir}/body.html`, bundle.html),
      // index.html inlines the frame bridge (window.qti.select +
      // data-qti-value delegation); the file is kept beside it as the source
      // a reader can edit.
      filesystem.writeFile(
        `${dir}/${FRAME_SCRIPT_FILENAME}`,
        FRAME_SELECT_SCRIPT,
      ),
      filesystem.writeFile(`${dir}/styles.css`, bundle.css),
      filesystem.writeFile(`${dir}/script.js`, bundle.javascript),
      // Spec visuals: the spec is the source of truth (everything else above
      // is synthetic), and the fixed runtime ships beside the frame bridge as
      // the editable source of what index.html inlines.
      ...(bundle.spec
        ? [
            filesystem.writeFile(
              `${dir}/${SPEC_FILENAME}`,
              JSON.stringify(bundle.spec, null, 2),
            ),
            filesystem.writeFile(
              `${dir}/${VISUAL_RUNTIME_FILENAME}`,
              VISUAL_RUNTIME_SCRIPT,
            ),
          ]
        : []),
      filesystem.writeFile(
        `${dir}/description.md`,
        `# ${bundle.title}\n\n${bundle.description}\n`,
      ),
      filesystem.writeFile(
        `${dir}/manifest.json`,
        JSON.stringify(
          {
            ...metadata,
            version,
            title: bundle.title,
            description: bundle.description,
            renderer: bundle.spec ? 'spec' : 'freeform',
          },
          null,
          2,
        ),
      ),
    ]);
  }

  private async readBundle(
    filesystem: WorkspaceFilesystem,
    meta: SessionVisualization,
    version: number,
  ): Promise<Bundle> {
    const dir = await this.resolveVersionDir(filesystem, meta, version);
    const [indexHtml, css, javascript] = await Promise.all([
      this.readText(filesystem, `${dir}/index.html`),
      this.readText(filesystem, `${dir}/styles.css`),
      this.readText(filesystem, `${dir}/script.js`),
    ]);
    let html: string;
    try {
      html = await this.readText(filesystem, `${dir}/body.html`);
    } catch {
      // Legacy visuals only stored index.html.
      html =
        indexHtml.match(/<body[^>]*>([\s\S]*?)<script\s+src=/i)?.[1] ??
        indexHtml;
    }
    let title = meta.title;
    let description = meta.description;
    try {
      const manifest = JSON.parse(
        await this.readText(filesystem, `${dir}/manifest.json`),
      ) as { title?: string; description?: string };
      title = manifest.title ?? title;
      description = manifest.description ?? description;
    } catch {
      // Fall back to session metadata.
    }
    const spec = await this.readSpec(filesystem, dir);
    // One shape for both renderers: a spec version reports the synthetic body,
    // sheet and bootstrap rather than whatever happens to sit on disk, so load,
    // download and tailor all see a self-consistent bundle.
    if (spec) {
      return {
        title,
        description,
        html: SPEC_BODY_HTML,
        css: '',
        javascript: SPEC_BOOTSTRAP_SCRIPT,
        spec,
      };
    }
    return { title, description, html, css, javascript };
  }

  /** A version's `spec.json`, when it has one and it still validates. */
  private async readSpec(
    filesystem: WorkspaceFilesystem,
    dir: string,
  ): Promise<VisualSpec | undefined> {
    let raw: string;
    try {
      raw = await this.readText(filesystem, `${dir}/${SPEC_FILENAME}`);
    } catch {
      return undefined; // Freeform visual.
    }
    try {
      const parsed = visualSpecSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      this.logger.warn(
        `Stored spec at ${dir} is invalid; rendering the stored files`,
      );
    } catch {
      this.logger.warn(
        `Stored spec at ${dir} is not JSON; rendering the stored files`,
      );
    }
    return undefined;
  }

  private async readText(
    filesystem: WorkspaceFilesystem,
    path: string,
  ): Promise<string> {
    const value = await filesystem.readFile(path, { encoding: 'utf-8' });
    return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  }
}

/** The successful result sets of a run: no error and at least one row. */
function successfulRecords(records: ToolDataRecord[]): ToolDataRecord[] {
  return records.filter((r) => !r.error && (r.rows?.length ?? 0) > 0);
}

/** Total rows the queries counted, for every successful result set. */
function countedRows(records: ToolDataRecord[]): number {
  return successfulRecords(records).reduce(
    (sum, r) => sum + (r.rowCount ?? r.rows?.length ?? 0),
    0,
  );
}

/** Rows a list of result sets holds. */
function rowsIn(records: ChartDataRecord[]): number {
  return records.reduce((sum, r) => sum + r.rows.length, 0);
}

/**
 * Halves the largest result set's rows (never below `floor`) until `size`
 * of the list fits `cap`, or no set can be cut further. Keeps the first rows,
 * so a cut set is always a prefix of the stored one.
 */
function shrinkToFit(
  records: ChartDataRecord[],
  cap: number,
  floor: number,
  size: (records: ChartDataRecord[]) => number,
): void {
  while (size(records) > cap && records.some((r) => r.rows.length > floor)) {
    const largest = records.reduce((a, b) =>
      a.rows.length >= b.rows.length ? a : b,
    );
    largest.rows = largest.rows.slice(
      0,
      Math.max(floor, Math.floor(largest.rows.length / 2)),
    );
  }
}

/**
 * What a spec visual is validated against and drawn from: every successful
 * result set with rows, in run order, each with all its stored rows. With
 * more than `VISUAL_RECORDS_CAP`, the ones with the most rows are kept (run
 * order breaks ties, then is restored). Embedded data over
 * `RENDER_DATA_CHARS_CAP` has its largest set halved, never under
 * `RENDER_MIN_ROWS_PER_RECORD` rows, until it fits.
 */
export function chartRecords(records: ToolDataRecord[]): ChartDataRecord[] {
  const successful = successfulRecords(records);
  const kept = successful
    .map((record, index) => ({ record, index }))
    .sort(
      (a, b) =>
        (b.record.rows?.length ?? 0) - (a.record.rows?.length ?? 0) ||
        a.index - b.index,
    )
    .slice(0, VISUAL_RECORDS_CAP)
    .sort((a, b) => a.index - b.index)
    .map(({ record: r }) => ({
      tool: r.tool,
      input: r.input,
      columns: r.columns,
      rowCount: r.rowCount,
      rows: r.rows ?? [],
    }));
  shrinkToFit(
    kept,
    RENDER_DATA_CHARS_CAP,
    RENDER_MIN_ROWS_PER_RECORD,
    (list) => JSON.stringify(list).length,
  );
  return kept;
}

/**
 * The frame's data for the runtime: every row `chartRecords` keeps, and the
 * "Chart built from the first X of Y rows" counts only when the rows drawn
 * are fewer than the queries counted (a capped result, a set left out over
 * the cap, or the size guard).
 */
function frameData(
  records: ToolDataRecord[] | undefined,
): Pick<VisualContext, 'chartData' | 'chartRows'> {
  if (!records?.length) return { chartData: undefined };
  const chartData = chartRecords(records);
  const drawn = rowsIn(chartData);
  const counted = countedRows(records);
  return {
    chartData,
    ...(counted > drawn
      ? { chartRows: { shown: drawn, truncatedFrom: counted } }
      : {}),
  };
}

/**
 * Fallback for transcripts recorded before `ChatMessage.reasoning` was
 * persisted: rebuild the same shape from the rationale each tool call
 * already carried, in the order the calls ran.
 */
function deriveReasoning(data: ToolDataRecord[] | undefined): ReasoningStep[] {
  return (data ?? [])
    .filter((record) => !!record.rationale)
    .map((record, index) => ({
      step: index + 1,
      rationale: record.rationale as string,
      tool: record.tool,
      input: record.input,
      rowCount: record.rowCount,
      error: record.error,
    }));
}

/** Human-readable companion file: question, takeaway, full answer, sources. */
function answerMarkdown(
  bundle: { title: string; description: string },
  context: VisualContext,
): string {
  const lines = [`# ${bundle.title}`, ''];
  if (context.question) lines.push(`**Question:** ${context.question}`, '');
  lines.push('## Takeaway', '', bundle.description, '');
  if (context.answer) lines.push('## Analysis', '', context.answer, '');
  if (context.reasoning?.length) {
    lines.push('## How this was worked out', '');
    context.reasoning.forEach((step) => {
      const outcome = step.error
        ? `failed — ${step.error}`
        : step.rowCount !== undefined
          ? `${step.rowCount.toLocaleString('en-US')} row${step.rowCount === 1 ? '' : 's'}`
          : undefined;
      lines.push(
        `${step.step}. ${step.rationale}${outcome ? ` (${outcome})` : ''}`,
      );
    });
    lines.push('');
  }
  if (context.data?.length) {
    lines.push('## Data used', '');
    context.data.forEach((record, index) => {
      const count = record.rowCount ?? record.rows?.length ?? 0;
      lines.push(
        `${index + 1}. \`${record.tool}\` — ${record.error ? 'failed' : `${count} rows`}`,
      );
      if (record.input) lines.push('', '```sql', record.input, '```', '');
    });
  }
  const meta = [
    context.sessionName ? `Session: ${context.sessionName}` : '',
    context.version ? `Version ${context.version}` : '',
    context.generatedAt ? `Generated ${context.generatedAt}` : '',
  ].filter(Boolean);
  if (meta.length) lines.push('---', '', meta.join(' · '), '');
  return lines.join('\n');
}
