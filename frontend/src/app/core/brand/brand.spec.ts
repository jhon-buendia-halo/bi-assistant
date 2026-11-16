import { BRAND } from './brand';
import { BRAND as MERCER } from './brand.mercer';

describe('brands (ADR-0045)', () => {
  it('builds Halo Workbench by default, with the flat shell and no LenAI badge', () => {
    expect(BRAND.id).toBe('halo');
    expect(BRAND.productName).toBe('Halo Workbench');
    expect(BRAND.headerTitle).toBe('Halo Workbench');
    expect(BRAND.welcomeName).toBe('Halo Workbench');
    expect(BRAND.wordmarkLabel).toBe('Workbench');
    expect(BRAND.shell).toBe('flat');
    expect(BRAND.poweredByLenai).toBeFalse();
    expect(BRAND.art).toBeNull();
  });

  it('describes Agentic Hub with the framed shell, its artwork and the LenAI badge', () => {
    expect(MERCER.id).toBe('mercer');
    expect(MERCER.productName).toBe('Agentic Hub');
    expect(MERCER.headerTitle).toBe('US Health Agentic Hub');
    expect(MERCER.shell).toBe('framed');
    expect(MERCER.wordmarkLabel).toBeNull();
    expect(MERCER.poweredByLenai).toBeTrue();
    const art = MERCER.art;
    expect(art).not.toBeNull();
    for (const src of Object.values(art ?? {})) {
      expect(src).toMatch(/^brand\/agentic-hub\/[a-z-]+\.(svg|webp)$/);
    }
  });

  it('keeps one brand\'s names out of the other', () => {
    const values = (brand: object) => JSON.stringify(Object.values(brand));
    expect(values(BRAND)).not.toMatch(/Agentic Hub|agentic-hub|LenAI/i);
    expect(values(MERCER)).not.toMatch(/Halo/);
  });
});
