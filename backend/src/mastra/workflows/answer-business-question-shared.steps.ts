import {
  publishCatalog,
  publishImageNotes,
  type BoardCatalogEntity,
  type BoardEntityColumns,
  type RunContextBoard,
} from './run-context';

// Answer a Business Question with a shared run context (experiment): the
// same turn as `answer-business-question`, plus one code step that publishes
// the catalogue's columns and Read images' notes to the run's board.

export const ANSWER_BUSINESS_QUESTION_SHARED_WORKFLOW_ID =
  'answer-business-question-shared';

export const PUBLISH_RUN_CONTEXT_STEP = {
  id: 'publish-run-context',
  title: 'Publish run context',
} as const;

/** Publishes Load catalog's data to the board: columns, then image notes. */
export function publishRunContext(
  board: RunContextBoard,
  data: {
    catalog: readonly BoardCatalogEntity[];
    columns: readonly BoardEntityColumns[];
    imageNotes?: string;
  },
): void {
  publishCatalog(board, data.catalog, data.columns);
  publishImageNotes(board, data.imageNotes);
}
