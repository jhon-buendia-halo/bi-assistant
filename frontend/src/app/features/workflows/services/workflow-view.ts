/**
 * The two views of a workflow's page (workflows R38; ui.md 4.4b):
 * **Builder**, the canvas and the Run panel, for people who build and debug
 * workflows; **Business**, the input form and the result in one column, for
 * people who only run a workflow and read its outcome. The last view picked
 * is kept on this device for every workflow; Business until one is picked.
 */
export type WorkflowView = 'builder' | 'business';

export const WORKFLOW_VIEW_STORAGE_KEY = 'qti.workflow-view';

export const DEFAULT_WORKFLOW_VIEW: WorkflowView = 'business';

/** The kept view, else Business; an unknown value is ignored. */
export function readWorkflowView(): WorkflowView {
  try {
    const value = localStorage.getItem(WORKFLOW_VIEW_STORAGE_KEY);
    return value === 'builder' || value === 'business'
      ? value
      : DEFAULT_WORKFLOW_VIEW;
  } catch {
    return DEFAULT_WORKFLOW_VIEW;
  }
}

export function writeWorkflowView(view: WorkflowView): void {
  try {
    localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage unavailable: the view is kept while the page is open.
  }
}
