import { renderMarkdown } from '../../../../shared/pipes/markdown.pipe';
import { blufParts } from './answer-bluf';

const ANSWER = [
  '**Francia es la selección con más goles: 14 en 6 partidos.** Esto vale solo para las fases finales de 2018 y 2022.',
  '',
  '| Puesto | Selección | Goles |',
  '|---|---|---|',
  '| 1 | Francia | 14 |',
  '',
  '**Cómo lo calculé**',
  '- Sumé local y visitante.',
  '',
  '**Supuestos**',
  '- Sin penaltis.',
  '',
  '**Advertencias**',
  '- No es el total histórico.',
].join('\n');

describe('blufParts (answer first, ui.md 4.4b)', () => {
  it('takes the opening bold sentence as the bottom line and the rest of its paragraph as its scope', () => {
    const parts = blufParts(renderMarkdown(ANSWER))!;
    expect(parts.headline).toBe(
      '<strong>Francia es la selección con más goles: 14 en 6 partidos.</strong>',
    );
    expect(parts.context).toBe(
      'Esto vale solo para las fases finales de 2018 y 2022.',
    );
  });

  it('keeps the table and the caveats open, and folds how it was worked out and the assumptions', () => {
    const parts = blufParts(renderMarkdown(ANSWER))!;
    expect(parts.body).toContain('<table');
    expect(parts.body).toContain('Advertencias');
    expect(parts.body).not.toContain('Sumé local');
    expect(parts.folded?.titles).toEqual(['Cómo lo calculé', 'Supuestos']);
    expect(parts.folded?.html).toContain('Sin penaltis.');
  });

  it('reads an answer that does not open with a bold sentence as written', () => {
    expect(blufParts(renderMarkdown('France scored **14**.'))).toBeNull();
    expect(
      blufParts(renderMarkdown('**Argentina** won the 2022 World Cup.')),
    ).toBeNull();
    expect(blufParts(renderMarkdown('**Summary**\n\nFrance.'))).toBeNull();
    expect(blufParts('')).toBeNull();
  });

  it('keeps figure chips inside the bottom line', () => {
    const parts = blufParts(
      '<p><strong>France: 14<button class="figure-ref" data-query-index="1">2</button>.</strong> Only 2018.</p>',
    )!;
    expect(parts.headline).toContain('class="figure-ref"');
    expect(parts.folded).toBeNull();
  });
});
