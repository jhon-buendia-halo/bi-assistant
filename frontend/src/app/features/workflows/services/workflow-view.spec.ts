import {
  WORKFLOW_VIEW_STORAGE_KEY,
  readWorkflowView,
  writeWorkflowView,
} from './workflow-view';

describe('workflow view, kept on this device (workflows R38)', () => {
  beforeEach(() => localStorage.removeItem(WORKFLOW_VIEW_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(WORKFLOW_VIEW_STORAGE_KEY));

  it('is Business until one is picked', () => {
    expect(readWorkflowView()).toBe('business');
  });

  it('reads back the view last written', () => {
    writeWorkflowView('builder');
    expect(localStorage.getItem(WORKFLOW_VIEW_STORAGE_KEY)).toBe('builder');
    expect(readWorkflowView()).toBe('builder');
    writeWorkflowView('business');
    expect(readWorkflowView()).toBe('business');
  });

  it('ignores an unknown kept value', () => {
    localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'Builder');
    expect(readWorkflowView()).toBe('business');
  });
});
