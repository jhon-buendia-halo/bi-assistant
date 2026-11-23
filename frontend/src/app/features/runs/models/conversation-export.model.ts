/**
 * The files Avery exported a conversation to (api.md 167). It rides on the
 * answer (`answer.export`, `ChatMessage.export`) and drives the export card.
 */
export interface ConversationExportFile {
  format: 'pdf' | 'pptx';
  fileName: string;
  bytes: number;
  /** Counted from the PDF. */
  pages?: number;
  /** The PowerPoint's slide count. */
  slides?: number;
}

export interface ConversationExportRef {
  id: string;
  title: string;
  createdAt: string;
  files: ConversationExportFile[];
}
