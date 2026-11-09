import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EntityDetails } from './entity-details';
import { DatasetSelectionService } from '../../services/dataset-selection.service';
import { DatasetSchemaNotesService } from '../../services/dataset-schema-notes.service';

describe('EntityDetails schema notes', () => {
  let fixture: ComponentFixture<EntityDetails>;
  let selection: DatasetSelectionService;
  let notes: DatasetSchemaNotesService;

  const el = (): HTMLElement => fixture.nativeElement;
  const select = () =>
    el().querySelector('[data-testid="schema-layer-select"]') as HTMLSelectElement | null;
  const textarea = () =>
    el().querySelector('[data-testid="schema-description"]') as HTMLTextAreaElement | null;

  function selectSchema(name: string): void {
    selection.select({
      kind: 'schema',
      catalogName: 'samples',
      schema: { name, tables: [] },
    });
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [EntityDetails] });
    selection = TestBed.inject(DatasetSelectionService);
    notes = TestBed.inject(DatasetSchemaNotesService);
    notes.load([{ key: 'samples.tpch', layer: 'consumption', description: 'Gold' }]);
    fixture = TestBed.createComponent(EntityDetails);
    selectSchema('tpch');
  });

  it('shows the stored layer and description of the selected schema', () => {
    expect(select()!.value).toBe('consumption');
    expect(textarea()!.value).toBe('Gold');
  });

  it('writes layer and description changes to the notes service', () => {
    const s = select()!;
    s.value = 'landing';
    s.dispatchEvent(new Event('change'));
    expect(notes.get('samples.tpch')?.layer).toBe('landing');

    const t = textarea()!;
    t.value = 'Raw files';
    t.dispatchEvent(new Event('input'));
    expect(notes.get('samples.tpch')?.description).toBe('Raw files');
  });

  it('shows None and an empty description for a schema without a note', () => {
    selectSchema('tpcds');
    expect(select()!.value).toBe('');
    expect(textarea()!.value).toBe('');
  });

  it('does not render the Layer select for a table or a catalog', () => {
    selection.select({
      kind: 'table',
      catalogName: 'samples',
      schemaName: 'tpch',
      table: { name: 'orders', columns: [] },
    });
    fixture.detectChanges();
    expect(select()).toBeNull();

    selection.select({
      kind: 'catalog',
      catalog: { name: 'samples', schemas: [] },
    });
    fixture.detectChanges();
    expect(select()).toBeNull();
  });
});
