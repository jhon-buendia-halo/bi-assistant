import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JsonSchema } from '../../models/workflow.model';
import { DataMode } from './workflow-data-view.util';
import { WorkflowDataView } from './workflow-data-view';

@Component({
  imports: [WorkflowDataView],
  template: `<app-workflow-data-view
    [value]="value()"
    [truncated]="truncated()"
    [modes]="modes()"
    [contract]="contract()"
    emptyText="Nothing here."
  />`,
})
class Host {
  readonly value = signal<unknown>({ rows: [{ state: 'CA', claims: 1 }] });
  readonly truncated = signal(false);
  readonly modes = signal<DataMode[]>(['json', 'table', 'schema']);
  readonly contract = signal<JsonSchema | null>(null);
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

  it('infers the schema from the value when no contract is declared', () => {
    byId('workflow-data-mode-schema')?.click();
    fixture.detectChanges();
    expect(byId('workflow-data-schema-declared')).toBeNull();
    expect(
      el().querySelectorAll('[data-testid="workflow-contract-field"]').length,
    ).toBe(0);
  });

  it('shows the declared contract in Schema mode, with types, required markers and descriptions', () => {
    host.contract.set({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: 'The rows returned.',
          items: {
            type: 'object',
            properties: { state: { type: 'string' }, total: { type: 'number' } },
            required: ['state'],
          },
        },
        stopped: { type: 'boolean' },
      },
      required: ['rows'],
    });
    fixture.detectChanges();
    byId('workflow-data-mode-schema')?.click();
    fixture.detectChanges();
    expect(byId('workflow-data-schema-declared')?.textContent?.trim()).toBe(
      'Declared contract',
    );
    const fields = Array.from(
      el().querySelectorAll<HTMLElement>('[data-testid="workflow-contract-field"]'),
    );
    // Name, type and description are separate cells of the row.
    const cells = (f: HTMLElement) =>
      Array.from(f.children)
        .map((c) => c.textContent?.replace(/\s+/g, ' ').trim())
        .join(' ');
    expect(fields.map(cells)).toEqual([
      'rows* (required) object[] The rows returned.',
      'state* (required) string',
      'total number',
      'stopped boolean',
    ]);
    expect(fields.map((f) => f.getAttribute('data-required'))).toEqual([
      'true',
      'true',
      'false',
      'false',
    ]);
    expect(fields[0].getAttribute('title')).toBe('The rows returned.');
    expect(fields[1].style.paddingLeft).toBe('1rem');
    // The value's own keys (e.g. `claims`) are not inferred.
    expect(byId('workflow-data-schema')?.textContent).not.toContain('claims');
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
