import {
  WORKFLOW_VIEW_STORAGE_KEY,
  readWorkflowView,
  writeWorkflowView,
} from './workflow-view';

describe('workflow view, kept on this device (workflows R38)', () => {
  beforeEach(() => localStorage.removeItem(WORKFLOW_VIEW_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(WORKFLOW_VIEW_STORAGE_KEY));

  it('is Builder until one is picked', () => {
    expect(readWorkflowView()).toBe('builder');
  });

  it('reads back the view last written', () => {
    writeWorkflowView('business');
    expect(localStorage.getItem(WORKFLOW_VIEW_STORAGE_KEY)).toBe('business');
    expect(readWorkflowView()).toBe('business');
    writeWorkflowView('builder');
    expect(readWorkflowView()).toBe('builder');
  });

  it('ignores an unknown kept value', () => {
    localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'Business');
    expect(readWorkflowView()).toBe('builder');
  });
});
