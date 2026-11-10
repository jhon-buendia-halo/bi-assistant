import { TestBed } from '@angular/core/testing';
import { DatasetSchemaNotesService } from './dataset-schema-notes.service';

describe('DatasetSchemaNotesService', () => {
  let service: DatasetSchemaNotesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DatasetSchemaNotesService);
  });

  it('builds schema keys as catalog.schema', () => {
    expect(service.schemaKey('samples', 'tpch')).toBe('samples.tpch');
  });

  it('load replaces notes and get reads them', () => {
    service.load([{ key: 'a.b', layer: 'landing', description: 'x' }]);
    expect(service.get('a.b')).toEqual({ key: 'a.b', layer: 'landing', description: 'x' });
    service.load([{ key: 'c.d', description: 'y' }]);
    expect(service.get('a.b')).toBeUndefined();
    expect(service.get('c.d')?.description).toBe('y');
  });

  it('load(undefined) and clear empty the notes', () => {
    service.load([{ key: 'a.b', layer: 'landing' }]);
    service.load(undefined);
    expect(service.notes().size).toBe(0);
    service.load([{ key: 'a.b', layer: 'landing' }]);
    service.clear();
    expect(service.notes().size).toBe(0);
  });

  it('setLayer sets the layer and an empty value removes it', () => {
    service.setLayer('a.b', 'normalized');
    expect(service.get('a.b')?.layer).toBe('normalized');
    service.setLayer('a.b', '');
    expect(service.get('a.b')?.layer).toBeUndefined();
    expect('layer' in service.get('a.b')!).toBeFalse();
  });

  it('setDescription keeps the existing layer', () => {
    service.setLayer('a.b', 'landing');
    service.setDescription('a.b', 'raw');
    expect(service.get('a.b')).toEqual({ key: 'a.b', layer: 'landing', description: 'raw' });
  });

  describe('toSave', () => {
    it('keeps only schemas that have an included table key', () => {
      service.load([
        { key: 'c.s1', layer: 'landing' },
        { key: 'c.s2', layer: 'consumption' },
      ]);
      expect(service.toSave(['c.s1.t1'])).toEqual([{ key: 'c.s1', layer: 'landing' }]);
    });

    it('trims descriptions, drops empty notes and never emits empty keys', () => {
      service.load([
        { key: 'c.s1', description: '  hello  ' },
        { key: 'c.s2', description: '   ' },
        { key: 'c.s3', layer: 'normalized', description: '' },
      ]);
      const out = service.toSave(['c.s1.t', 'c.s2.t', 'c.s3.t']);
      expect(out).toEqual([
        { key: 'c.s1', description: 'hello' },
        { key: 'c.s3', layer: 'normalized' },
      ]);
      expect('layer' in out[0]).toBeFalse();
      expect('description' in out[1]).toBeFalse();
    });

    it('sorts by key', () => {
      service.load([
        { key: 'c.b', layer: 'landing' },
        { key: 'c.a', layer: 'landing' },
      ]);
      expect(service.toSave(['c.b.t', 'c.a.t']).map((n) => n.key)).toEqual(['c.a', 'c.b']);
    });
  });
});
