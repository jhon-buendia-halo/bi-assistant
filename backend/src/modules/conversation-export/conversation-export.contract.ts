/**
 * The conversation export (agents.md 3.18; api.md 167; ADR-0056): what the
 * turn engine asks of it and what it answers. Framework-free, so the
 * sessions module reaches it by token without importing the module behind
 * it.
 */
import type { ExportContent } from '../../mastra/workflows/export-request';

/** The injection token of the `ConversationExporter`. */
export const CONVERSATION_EXPORTER = 'CONVERSATION_EXPORTER';

/** A file format an export can have. */
export type ExportFormat = 'pdf' | 'pptx';

/** One file of an export, as the wire shows it. */
export interface ConversationExportFile {
  format: ExportFormat;
  /** `<slug of the title>.pdf` or `.pptx`. */
  fileName: string;
  bytes: number;
  /** The PDF's page count. */
  pages?: number;
  /** The PowerPoint's slide count. */
  slides?: number;
}

/**
 * An export of a conversation (api.md 167): on the answer that made it
 * (`answer.export`, `ChatMessage.export`) and stored in
 * `conversation_exports` (data-model 3.20).
 */
export interface ConversationExportRef {
  id: string;
  title: string;
  createdAt: string;
  files: ConversationExportFile[];
}

/** The brand the files are drawn in: Halo by default. */
export type ExportBrand = 'halo' | 'mercer';

/** What an export is made of. */
export interface ConversationExportInput {
  conversationId: string;
  /** The run asking for it: only the runs before it are exported. */
  beforeRunId: string;
  /** What Avery wrote for the file (the tool's input). */
  content: ExportContent;
  brand: ExportBrand;
}

/** The conversation's ended turns before a run, oldest first. */
export interface ConversationTurns {
  questions: string[];
  /** Each turn's answer (markdown), in the same order. */
  answers: string[];
}

/** The message when no Edge or Chrome can be launched. */
export const NO_EXPORT_BROWSER_MESSAGE =
  'Exporting needs Microsoft Edge or Google Chrome on this computer.';

/** The exporter the turn engine calls. */
export interface ConversationExporter {
  /** The conversation's ended turns before `beforeRunId` (Avery's facts, the figure check). */
  turns(
    conversationId: string,
    beforeRunId: string,
  ): Promise<ConversationTurns>;
  /** Make the files and store the export; throws with a message for Avery. */
  export(input: ConversationExportInput): Promise<ConversationExportRef>;
}
