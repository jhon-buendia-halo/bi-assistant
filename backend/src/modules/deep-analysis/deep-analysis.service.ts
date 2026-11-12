import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MastraService } from '../../mastra/mastra.service';
import { SessionsService } from '../sessions/sessions.service';
import type { SessionDoc } from '../sessions/entities/session.entity';
import {
  extractSqlBlocks,
  reportMarkdown,
  reportSlug,
} from '../../mastra/workflows/deep-analysis.steps';

type WorkspaceFilesystem = NonNullable<
  Awaited<ReturnType<MastraService['ensureSessionWorkspace']>>['filesystem']
>;

/** Directory reports live in, inside the session's Mastra workspace. */
const REPORTS_DIR = 'reports';

/**
 * A deep analysis report a past chat holds (agents.md 5.15): since 1.23.27
 * the report is only read back, as the `deep-analysis` run workflow writes
 * new ones to a run's workspace.
 */
@Injectable()
export class DeepAnalysisService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly mastra: MastraService,
  ) {}

  /**
   * The stored markdown. Read straight from the workspace by job id, so a
   * report stays downloadable after the backend restarts; named after the
   * title on its first line.
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
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1];
    return {
      filename: `${reportSlug(title) || `deep-analysis-${jobId.slice(0, 8)}`}.md`,
      markdown,
    };
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
}

export function reportPath(jobId: string): string {
  return `${REPORTS_DIR}/${jobId}.md`;
}

// The report's pure code is the run workflow's (deep-analysis.steps.ts).
export { extractSqlBlocks, reportMarkdown };
