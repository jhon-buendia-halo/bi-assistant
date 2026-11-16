import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NodeInspection, NodeRunView } from '../../models/workflow-node.model';
import { WorkflowRunStory } from './workflow-run-story';

function node(
  nodeId: string,
  kind: NodeInspection['kind'],
  run: NodeRunView | null,
): NodeInspection {
  return {
    nodeId,
    kind,
    title: nodeId === 'analyse' ? 'Analyse' : 'Clarify',
    number: null,
    summary: '',
    step: null,
    agent: null,
    run,
    context: null,
  };
}

const NODES = [
  node('analyse', 'agent', {
    status: 'success',
    durationMs: 15000,
    toolCalls: [],
    startedAt: '2026-11-16T10:00:00.000Z',
    endedAt: '2026-11-16T10:00:15.000Z',
    story: {
      headline: 'Ran 3 queries on the data.',
      stats: [{ value: '3', label: 'queries' }],
      source: 'step',
    },
  }),
  node('clarify', 'code', {
    status: 'skipped',
    durationMs: null,
    toolCalls: [],
    story: {
      headline: 'Skipped: nothing in the plan needed your answer.',
      source: 'step',
    },
  }),
];

describe('WorkflowRunStory (How it ran, ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowRunStory>;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (id: string) =>
    byId(id)?.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [WorkflowRunStory] });
    fixture = TestBed.createComponent(WorkflowRunStory);
    fixture.componentRef.setInput('nodes', NODES);
    fixture.detectChanges();
  });

  it('starts folded, its first figures on its toggle', () => {
    const toggle = byId('workflow-run-story-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(text('workflow-run-story-summary')).toBe(
      '15.0 s to run · 3 queries',
    );
    expect(
      el().querySelector<HTMLElement>('#workflow-run-story-body')!.hidden,
    ).toBeTrue();
  });

  it('unfolds to the figures and one line per step; a title opens its step', () => {
    byId('workflow-run-story-toggle')!.click();
    fixture.detectChanges();
    expect(
      byId('workflow-run-story-toggle')!.getAttribute('aria-expanded'),
    ).toBe('true');
    expect(text('workflow-run-story-step-analyse')).toContain(
      'Ran 3 queries on the data.',
    );
    expect(text('workflow-run-story-step-clarify')).toContain(
      'Clarify (skipped)',
    );
    const opened: string[] = [];
    fixture.componentInstance.openNode.subscribe((id) => opened.push(id));
    byId('workflow-run-story-step-clarify')!.querySelector('button')!.click();
    expect(opened).toEqual(['clarify']);
  });
});
