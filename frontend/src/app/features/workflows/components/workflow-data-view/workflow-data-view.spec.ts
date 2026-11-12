import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataMode } from './workflow-data-view.util';
import { WorkflowDataView } from './workflow-data-view';

@Component({
  imports: [WorkflowDataView],
  template: `<app-workflow-data-view
    [value]="value()"
    [truncated]="truncated()"
    [modes]="modes()"
    emptyText="Nothing here."
  />`,
})
class Host {
  readonly value = signal<unknown>({ rows: [{ state: 'CA', claims: 1 }] });
  readonly truncated = signal(false);
  readonly modes = signal<DataMode[]>(['json', 'table', 'schema']);
}

describe('WorkflowDataView', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts in JSON and pretty-prints the value', () => {
    expect(byId('workflow-data-mode-json')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(byId('workflow-data-json')?.textContent).toBe(
      JSON.stringify(host.value(), null, 2),
    );
  });

  it('switches to the table and the schema', () => {
    byId('workflow-data-mode-table')?.click();
    fixture.detectChanges();
    expect(byId('workflow-data-table')?.textContent).toContain('CA');
    expect(byId('workflow-data-table')?.textContent).toContain('claims');
    expect(byId('workflow-data-mode-table')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(byId('workflow-data-json')).toBeNull();

    byId('workflow-data-mode-schema')?.click();
    fixture.detectChanges();
    expect(byId('workflow-data-schema')?.textContent).toContain('rows');
    expect(byId('workflow-data-schema')?.textContent).toContain('object[]');
  });

  it('hides the Table mode when the value has no rows', () => {
    host.value.set({ question: 'x' });
    fixture.detectChanges();
    expect(byId('workflow-data-mode-table')).toBeNull();
    expect(byId('workflow-data-mode-schema')).not.toBeNull();
  });

  it('offers only the modes it is given', () => {
    host.modes.set(['json', 'schema']);
    fixture.detectChanges();
    expect(byId('workflow-data-mode-table')).toBeNull();
    expect(byId('workflow-data-mode-json')).not.toBeNull();
  });

  it('shows the empty text when there is no value', () => {
    host.value.set(undefined);
    fixture.detectChanges();
    expect(byId('workflow-data-empty')?.textContent).toContain('Nothing here.');
    expect(byId('workflow-data-mode-json')).toBeNull();
  });

  it('shows the truncated note instead of the empty text', () => {
    host.value.set(undefined);
    host.truncated.set(true);
    fixture.detectChanges();
    expect(byId('workflow-data-truncated')?.textContent).toContain(
      'Larger than 20 000 characters, not kept.',
    );
    expect(byId('workflow-data-empty')).toBeNull();
  });
});
