import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EntityEditor } from './entity-editor';
import { DataModelApiService } from '../../services/data-model-api.service';
import { DataModel } from '../../models/data-model.model';

const MODEL: DataModel = {
  model: 'world_cup',
  version: 1,
  entities: [
    {
      name: 'matches',
      key: ['id'],
      bindings: [],
      attributes: [
        { name: 'id', type: 'integer', role: 'key' },
        { name: 'home_team_id', type: 'integer' },
      ],
    },
    {
      name: 'teams',
      key: ['id'],
      bindings: [],
      attributes: [{ name: 'id', type: 'integer', role: 'key' }],
    },
  ],
  relationships: [
    {
      from: 'matches.home_team_id',
      to: 'teams.id',
      cardinality: 'many_to_one',
      source: 'declared',
    },
  ],
  metrics: [],
};

describe('EntityEditor', () => {
  let fixture: ComponentFixture<EntityEditor>;
  let component: EntityEditor;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityEditor],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DataModelApiService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EntityEditor);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('datasetName', 'World Cup Core');
    fixture.componentRef.setInput('model', MODEL);
    fixture.componentRef.setInput('focusEntityName', 'matches');
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (selector: string) => el().querySelector(selector);

  it('shows Save, the add select and Remove, with enabled inputs, by default', () => {
    expect(q('[data-testid="save-entity"]')).not.toBeNull();
    expect(q('[data-testid="add-relationship"]')).not.toBeNull();
    expect(q('[data-testid="relationship-0"] button[title="Remove"]')).not.toBeNull();
    const cardinality = q('[data-testid="relationship-cardinality-0"]') as HTMLSelectElement;
    expect(cardinality.disabled).toBe(false);
  });

  it('becomes savable after a cardinality change', () => {
    component.updateRelationshipCardinality(0, 'one_to_one');
    expect(component.canSave()).toBe(true);
  });

  describe('read-only (without Manage datasources)', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('readOnly', true);
      fixture.detectChanges();
    });

    it('hides Save, the add select and Remove', () => {
      expect(q('[data-testid="save-entity"]')).toBeNull();
      expect(q('[data-testid="add-relationship"]')).toBeNull();
      expect(q('button[title="Remove"]')).toBeNull();
    });

    it('disables every input and select of the form', () => {
      const controls = Array.from(
        el().querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input, select, textarea',
        ),
      );
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every((c) => c.disabled)).toBe(true);
    });

    it('keeps the entity list usable', () => {
      (q('[data-testid="entity-teams"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(component.selectedEntityName()).toBe('teams');
    });

    it('ignores edits, so nothing becomes savable', () => {
      component.updateRelationshipCardinality(0, 'one_to_one');
      component.updateEntityLabel('Games');
      component.removeRelationship(0);
      expect(component.dirty()).toBe(false);
      expect(component.canSave()).toBe(false);
    });
  });
});
