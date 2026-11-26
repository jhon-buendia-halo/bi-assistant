import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RunVisual } from './run-visual';
import { RunVisualsState } from '../../services/run-visuals-state';
import { InteractiveVisualPanel } from '../../../sessions/components/interactive-visual-panel/interactive-visual-panel';
import type { WorkflowRun } from '../../../workflows/models/workflow.model';

/** A stand-in for the shared panel: only what RunVisual hands it. */
@Component({
  selector: 'app-interactive-visual-panel',
  template:
    '<div data-testid="panel" [attr.data-read-only]="readOnly()" [attr.data-chrome]="chrome()"></div>',
})
class PanelStub {
  readonly runId = input<string | null>(null);
  readonly visualization = input<unknown>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly downloading = input(false);
  readonly readOnly = input(false);
  readonly chrome = input(true);
  readonly downloadVisual = output<unknown>();
  readonly selectVersion = output<unknown>();
  readonly revertVersion = output<unknown>();
  readonly visualRefreshed = output<unknown>();
}

/** The state with one visual open on run `run-1`. */
function stateWithVisual() {
  return {
    shown: signal({
      runId: 'run-1',
      visualization: { id: 'v-1', title: 'Managed Business vs Aetna' },
    }),
    loading: signal(false),
    error: signal<string | null>(null),
    downloading: signal<string | null>(null),
    close: jasmine.createSpy('close'),
    download: jasmine.createSpy('download'),
    selectVersion: jasmine.createSpy('selectVersion'),
    revert: jasmine.createSpy('revert'),
    adopt: jasmine.createSpy('adopt'),
  };
}

describe("RunVisual, a run's visual under its answer (visuals R12-R24; agents.md 5.19)", () => {
  function render(workflowId: string, sheet = false) {
    const state = stateWithVisual();
    TestBed.configureTestingModule({
      imports: [RunVisual],
      providers: [{ provide: RunVisualsState, useValue: state }],
    });
    TestBed.overrideComponent(RunVisual, {
      remove: { imports: [InteractiveVisualPanel] },
      add: { imports: [PanelStub] },
    });
    const fixture = TestBed.createComponent(RunVisual);
    fixture.componentRef.setInput('run', {
      id: 'run-1',
      workflowId,
    } as WorkflowRun);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const section = () =>
      el.querySelector('[data-testid="run-visual"]') as HTMLElement;
    const toggle = () =>
      el.querySelector(
        '[data-testid="run-visual-full-screen"]',
      ) as HTMLButtonElement;
    return { fixture, el, state, section, toggle };
  }

  it('opens full screen as a modal dialog and leaves it with the button, Escape or the backdrop', () => {
    const { fixture, el, section, toggle } = render('answer-business-question');
    expect(section().getAttribute('data-full-screen')).toBeNull();
    expect(toggle().getAttribute('aria-label')).toBe('Full screen');

    toggle().click();
    fixture.detectChanges();
    expect(section().getAttribute('data-full-screen')).toBe('true');
    expect(section().getAttribute('role')).toBe('dialog');
    expect(section().getAttribute('aria-modal')).toBe('true');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('Exit full screen');

    section().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(section().getAttribute('data-full-screen')).toBeNull();

    toggle().click();
    fixture.detectChanges();
    (
      el.querySelector(
        'button[aria-label="Exit full screen"].fixed',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(section().getAttribute('data-full-screen')).toBeNull();
  });

  it("opens as a side panel titled once by the visual, without the panel's own label and path; Escape closes it (R42)", () => {
    const { fixture, state, section } = render(
      'answer-business-question',
      true,
    );
    expect(section().getAttribute('data-sheet')).toBe('true');
    expect(section().getAttribute('role')).toBe('dialog');
    expect(section().getAttribute('aria-label')).toBe(
      'Managed Business vs Aetna',
    );
    expect(section().classList).toContain('run-visual-sheet');
    expect(
      section()
        .querySelector('[data-testid="run-visual-title"]')
        ?.textContent?.trim(),
    ).toBe('Managed Business vs Aetna');
    expect(
      section()
        .querySelector('[data-testid="run-visual-kind"]')
        ?.textContent?.trim(),
    ).toBe('Visual');
    expect(
      section()
        .querySelector('[data-testid="panel"]')
        ?.getAttribute('data-chrome'),
    ).toBe('false');

    section().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(state.close).toHaveBeenCalled();
  });

  it("stays under the answer, with the panel's own label, when not a side panel", () => {
    const { section } = render('answer-business-question');
    expect(section().getAttribute('data-sheet')).toBeNull();
    expect(section().getAttribute('role')).toBeNull();
    expect(
      section()
        .querySelector('[data-testid="panel"]')
        ?.getAttribute('data-chrome'),
    ).toBe('true');
  });

  it('keeps Tailor and Refresh on the visual', () => {
    const other = render('answer-business-question');
    expect(
      other.el
        .querySelector('[data-testid="panel"]')
        ?.getAttribute('data-read-only'),
    ).toBe('false');
  });
});
