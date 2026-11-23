import {
  asksForExport,
  exportContentSchema,
  figuresNotInAnswers,
} from './export-request';

/**
 * Trimmed excerpts of real answers: a conversation with Avery over the
 * Intellify dataset (Spanish, run f4980fba and its follow-ups) and one over
 * the World Cup dataset (English, run 4b0cc1b7 and its follow-ups).
 */
const INTELLIFY_ANSWERS = [
  '**Puedes comparar los 11 productos activos con unas 12 métricas, agrupadas en volumen, dinero, precio, coste para el empleador, tendencia y avance operativo.** Medical es el producto más grande con diferencia: 2.325 M USD de prima anual.\n\n| Producto | Clientes | Prima anual (M USD) | Crec. vs año anterior |\n|---|---|---|---|\n| Medical | 39 | 2.324,7 | 7,6% |\n| Dental | 35 | 141,5 | 7,0% |',
  '**Los 38 clientes activos tienen de media 6,3 de los 11 productos (58% de penetración) y la mediana es 6.** Ninguno tiene solo Medical: el que menos tiene es Ironwood Media, con 4. Cinco clientes llegan a 8 o más, y Orchard Manufacturing va en cabeza con 9 (82%).',
  'He creado el dashboard «Penetración de productos y coberturas por cliente» (versión 1). Compara los 38 clientes activos y los 11 productos con penetración, coberturas, pólizas y la prima anual de contexto.',
  'He quitado el gráfico «Productos con diseño de plan por cliente». El dashboard está ya en la versión 2 y tiene 11 widgets. Los demás gráficos, los indicadores, la matriz cliente × producto y los 5 filtros (cliente, producto, aseguradora, estado y grupo de número de productos) no han cambiado.',
];

const WORLD_CUP_ANSWERS = [
  'I\'ve built "World Cup Goals by Team and Tournament" (version 1). It shows each team\'s goals scored and conceded, matches played and wins, broken down by tournament and stage, and you can filter it by tournament, stage and team.',
  'Version 2 of "World Cup Goals by Team and Tournament" is ready. The table has been replaced by a bar chart of goals by stage, with the stages in tournament order (group stage through to the final).',
  'I\'ve removed the stage filter, so "World Cup Goals by Team and Tournament" is now on version 3 with two filters left: tournament and team.',
];

describe('asksForExport (the gate of export_conversation)', () => {
  it.each([
    'Export this conversation to PDF',
    'Can you download the chat as a PowerPoint?',
    'Share the analysis as slides',
    'Make a PDF of this conversation',
    'Turn the whole report into a deck',
    'export the report',
    'Download it as PPTX please',
    'I need a presentation of this analysis',
    'Exporta la conversación a PDF',
    'Descarga el informe en PowerPoint',
    'Comparte el análisis con mi jefe',
    'Hazme unas diapositivas con todo esto',
    'Exportar el chat como presentación',
    'Prepárame una presentación del análisis',
    'genera un pdf',
  ])('opens for %p', (text) => {
    expect(asksForExport(text)).toBe(true);
  });

  it.each([
    'What does the report say about sales in 2022?',
    'Show me the sales report by region',
    'Create a report of goals by team',
    'Download the data as CSV',
    'Export the rows to Excel',
    'Which team scored the most goals?',
    'Create a dashboard of goals by team and tournament',
    '¿Qué dice el informe de ventas?',
    '¿Cuál es la presentación del producto Medical?',
    'ahora crea un dashboard',
    'haz una comparacion por clientes usando las metricas de penetracion y coberturas',
    '',
  ])('stays shut for %p', (text) => {
    expect(asksForExport(text)).toBe(false);
  });
});

describe('figuresNotInAnswers (the figure check of export_conversation)', () => {
  it('passes the figures copied from the Spanish answers, in either grouping', () => {
    expect(
      figuresNotInAnswers(
        [
          'Penetración de productos y coberturas en Intellify',
          'Los 11 productos activos se comparan con unas 12 métricas.',
          'Los 38 clientes activos tienen de media 6,3 de los 11 productos (58% de penetración); Orchard Manufacturing lidera con 9.',
          'Medical es el producto más grande: 2.325 M USD de prima anual.',
          // The same value in the other grouping: 2,325 is 2.325.
          'Medical: 2,325 M USD and 2,324.7 in the table.',
          'El dashboard está en su versión 2, con 11 widgets y 5 filtros.',
        ],
        INTELLIFY_ANSWERS,
      ),
    ).toEqual([]);
  });

  it('names each figure that is in no Spanish answer, once, in order', () => {
    expect(
      figuresNotInAnswers(
        [
          'Medical llega al 97,4% de los clientes.',
          'Los clientes tienen de media 6,4 productos; 6,3 es la mediana.',
          'Medical llega al 97,4% otra vez.',
        ],
        INTELLIFY_ANSWERS,
      ),
    ).toEqual(['97,4', '6,4']);
  });

  it('never reads a decimal comma as a thousands group (6,3 is not 63)', () => {
    expect(figuresNotInAnswers(['63 clientes'], ['media 6,3'])).toEqual(['63']);
  });

  it('passes the English answers’ figures and refuses the dashboard’s own counts', () => {
    expect(
      figuresNotInAnswers(
        [
          'World Cup goals by team and tournament',
          'The dashboard went from version 1 to version 3.',
        ],
        WORLD_CUP_ANSWERS,
      ),
    ).toEqual([]);
    // 10 widgets and 32 rows are the dashboard's, not an answer's words.
    expect(
      figuresNotInAnswers(
        ['A dashboard of 10 widgets on 32 rows, version 2.'],
        WORLD_CUP_ANSWERS,
      ),
    ).toEqual(['10', '32']);
  });
});

describe('exportContentSchema (the input of export_conversation)', () => {
  const content = {
    title: 'World Cup goals',
    summary: ['First finding', 'Second finding'],
    turns: [{ number: 1, headline: 'Built version 1', points: [] }],
  };

  it('takes both formats and no SQL by default', () => {
    expect(exportContentSchema.parse(content)).toMatchObject({
      formats: ['pdf', 'pptx'],
      includeSql: false,
    });
  });

  it('refuses one summary bullet, a long headline or four points', () => {
    expect(
      exportContentSchema.safeParse({ ...content, summary: ['only one'] })
        .success,
    ).toBe(false);
    expect(
      exportContentSchema.safeParse({
        ...content,
        turns: [{ number: 1, headline: 'x'.repeat(91), points: [] }],
      }).success,
    ).toBe(false);
    expect(
      exportContentSchema.safeParse({
        ...content,
        turns: [{ number: 1, headline: 'ok', points: ['a', 'b', 'c', 'd'] }],
      }).success,
    ).toBe(false);
    expect(
      exportContentSchema.safeParse({ ...content, formats: [] }).success,
    ).toBe(false);
  });
});
