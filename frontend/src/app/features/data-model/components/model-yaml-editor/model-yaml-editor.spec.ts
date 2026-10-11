import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModelYamlEditor } from './model-yaml-editor';

describe('ModelYamlEditor', () => {
  let fixture: ComponentFixture<ModelYamlEditor>;
  let component: ModelYamlEditor;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelYamlEditor],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ModelYamlEditor);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('datasetName', 'World Cup Core');
    fixture.componentRef.setInput('yaml', 'model: world_cup\nversion: 1\nentities: []\n');
    fixture.detectChanges();
  });

  it('loads the given yaml into the editable text and is not dirty yet', () => {
    expect(component.text()).toBe('model: world_cup\nversion: 1\nentities: []\n');
    expect(component.dirty()).toBe(false);
    expect(component.canSave()).toBe(false);
  });

  it('becomes dirty and savable once the text changes', () => {
    component.onInput('model: world_cup\nversion: 1\nentities: []\nextra: 1\n');
    expect(component.dirty()).toBe(true);
    expect(component.canSave()).toBe(true);
  });

  it('computes one line number per line, including the trailing blank line', () => {
    expect(component.lineNumbers()).toEqual([1, 2, 3, 4]);
  });

  it('jumpToError sets the highlighted line from the issue, and clears it on edit', () => {
    component.jumpToError({ path: 'entities[0].name', message: 'bad', line: 2, col: 1 });
    expect(component.highlightedLine()).toBe(2);

    component.onInput('changed');
    expect(component.highlightedLine()).toBeNull();
  });

  it('ignores a jump request for an issue with no located line', () => {
    component.jumpToError({ path: '', message: 'syntax error' });
    expect(component.highlightedLine()).toBeNull();
  });

  it('re-syncs the editable text and clears errors when a new yaml input arrives (e.g. after a revert)', () => {
    component.jumpToError({ path: 'x', message: 'bad', line: 1, col: 1 });
    fixture.componentRef.setInput('yaml', 'model: world_cup\nversion: 2\nentities: []\n');
    fixture.detectChanges();

    expect(component.text()).toBe('model: world_cup\nversion: 2\nentities: []\n');
    expect(component.highlightedLine()).toBeNull();
    expect(component.errors()).toEqual([]);
  });
});
