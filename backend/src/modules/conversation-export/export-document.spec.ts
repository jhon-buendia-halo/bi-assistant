// `marked` ships ESM only; Jest loads its UMD build instead.
jest.mock('marked', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
  require('../../../node_modules/marked/lib/marked.umd.js'),
);

import type { ExportContent } from '../../mastra/workflows/export-request';
import type { DashboardRef } from '../artifacts/entities/artifact.entity';
import {
  conversationLanguage,
  dashboardVersionsNeeded,
  exportDocument,
  exportHtml,
  exportSlides,
  firstMarkdownTable,
  tablesOfSql,
  type ExportDashboard,
  type ExportRun,
} from './export-document';

const PNG = Buffer.from('png');

const V1: DashboardRef = {
  artifactId: 'a-1',
  version: 1,
  title: 'Penetración de productos y coberturas por cliente',
  action: 'created',
  widgetCount: 12,
  filterCount: 5,
  rowCount: 418,
  saved: false,
};
const V2: DashboardRef = {
  ...V1,
  version: 2,
  action: 'updated',
  widgetCount: 11,
};

/** Trimmed excerpts of the Intellify conversation (run f4980fba). */
const RUNS: ExportRun[] = [
  {
    id: 'r1',
    question: 'que metricas podemos usar para comparar los productos',
    startedAt: '2026-11-23T02:55:09.352Z',
    answer: {
      content:
        '**Puedes comparar los 11 productos activos con unas 12 métricas.** Medical es el producto más grande: 2.325 M USD de prima anual.\n\n| Producto | Clientes | Prima anual (M USD) | Crec. | Aumento | Vidas | Prima/vida | % empleador |\n|---|---|---|---|---|---|---|---|\n| **Medical** | 39 | 2.324,7 | 7,6% | 7,9% | 172.180 | 1.125,15 | 79,4% |\n| Dental | 35 | 141,5 | 7,0% | 7,9% | 146.005 | 80,76 | 41,5% |\n\n<script>alert(1)</script>',
      data: [
        {
          tool: 'run_readonly_sql',
          input:
            'SELECT p.name FROM intellify.intellify.products p JOIN intellify.intellify.policy_coverages c ON c.product_id = p.id',
          rationale: 'Qué productos hay y sus coberturas.',
          rowCount: 12,
        },
        {
          tool: 'sample_rows',
          input: 'intellify.intellify.products',
          rowCount: 3,
        },
      ],
      evidence: [
        {
          index: 0,
          tables: [
            { entity: 'intellify.intellify.products', rows: 11 },
            { entity: 'intellify.intellify.policy_coverages', rows: 306 },
          ],
        },
      ],
    },
    datasets: ['Intellify'],
  },
  {
    id: 'r2',
    question: 'ahora crea un dashboard',
    startedAt: '2026-11-23T03:00:25.383Z',
    answer: {
      content:
        'He creado el dashboard «Penetración de productos y coberturas por cliente» (versión 1).',
      dashboard: V1,
    },
    datasets: ['Intellify'],
  },
  {
    id: 'r3',
    question:
      'remueve el chart que se llama "Productos con diseño de plan por cliente"',
    startedAt: '2026-11-23T03:05:46.819Z',
    answer: {
      content:
        'He quitado el gráfico. El dashboard está ya en la versión 2 y tiene 11 widgets.',
      dashboard: V2,
    },
    datasets: ['Intellify'],
  },
];

const CONTENT: ExportContent = {
  formats: ['pdf', 'pptx'],
  title: 'Penetración de productos y coberturas en Intellify',
  subtitle: 'Qué métricas comparan los productos y el dashboard que lo sigue',
  summary: [
    'Los 11 productos activos se comparan con unas 12 métricas.',
    'El dashboard está en su versión 2, con 11 widgets.',
  ],
  turns: [
    {
      number: 1,
      headline: '12 métricas comparan los 11 productos activos',
      points: [
        'Medical es el producto más grande: 2.325 M USD de prima anual.',
      ],
    },
    { number: 2, headline: 'Dashboard de penetración, versión 1', points: [] },
  ],
  includeSql: false,
};

/** A drawn dashboard: the latest with two rows (one with a table widget). */
function drawn(): Map<string, ExportDashboard> {
  const table = {
    title: 'Matriz cliente × producto',
    header: ['Cliente', 'Productos'],
    rows: Array.from({ length: 20 }, (_, i) => [`Cliente ${i + 1}`, String(i)]),
  };
  return new Map<string, ExportDashboard>([
    [
      'r2',
      {
        ref: V1,
        latest: false,
        replacedBy: 2,
        filters: ['Cliente', 'Producto'],
        status: 'draft',
        rows: [{ image: { png: PNG, width: 1268, height: 140 }, tables: [] }],
      },
    ],
    [
      'r3',
      {
        ref: V2,
        latest: true,
        summary: 'Penetración por cliente y producto.',
        filters: ['Cliente', 'Producto'],
        status: 'draft',
        rows: [
          { image: { png: PNG, width: 1268, height: 140 }, tables: [] },
          { image: { png: PNG, width: 1268, height: 900 }, tables: [] },
          { tables: [table] },
        ],
      },
    ],
  ]);
}

describe('the export document (agents.md 3.18)', () => {
  it('shows the latest dashboard version in full and an earlier one as replaced', () => {
    expect(dashboardVersionsNeeded(RUNS)).toEqual([
      { runId: 'r2', ref: V1, latest: false, replacedBy: 2 },
      { runId: 'r3', ref: V2, latest: true },
    ]);
  });

  it('reads the conversation’s language from its words', () => {
    expect(conversationLanguage(RUNS.map((run) => run.question))).toBe('es');
    expect(
      conversationLanguage([
        'Create a dashboard of goals by team and tournament',
        'Replace the table with a bar chart of goals by stage',
      ]),
    ).toBe('en');
  });

  it("names the conversation's agent as its author: Avery with her team by default, Elena on her own (plan Elena 1.3)", () => {
    const avery = exportDocument({
      runs: RUNS,
      content: CONTENT,
      brand: 'halo',
      dashboards: drawn(),
    });
    expect(exportHtml(avery)).toContain('Avery · Chief of Staff');
    expect(exportHtml(avery)).toContain('Avery, Chief of Staff, con su equipo');
    const elena = exportDocument({
      runs: RUNS,
      content: CONTENT,
      brand: 'halo',
      dashboards: drawn(),
      author: { name: 'Elena', role: 'Insights Lead' },
    });
    const html = exportHtml(elena);
    expect(html).toContain('Elena · Insights Lead');
    expect(html).toContain('Elena, Insights Lead</span>');
    expect(html).not.toContain('Avery');
    expect(JSON.stringify(exportSlides(elena))).toContain(
      'preparado por Elena',
    );
  });

  it('maps turn k to the k-th earlier question, and falls back to the question', () => {
    const doc = exportDocument({
      runs: RUNS,
      content: CONTENT,
      brand: 'halo',
      dashboards: drawn(),
    });
    expect(doc.language).toBe('es');
    expect(doc.datasets).toEqual(['Intellify']);
    expect(doc.turns.map((turn) => turn.headline)).toEqual([
      '12 métricas comparan los 11 productos activos',
      'Dashboard de penetración, versión 1',
      RUNS[2].question,
    ]);
    // Only the SQL records are queries; their tables come from the evidence.
    expect(doc.turns[0].queries).toEqual([
      {
        rationale: 'Qué productos hay y sus coberturas.',
        rowCount: 12,
        tables: ['products', 'policy_coverages'],
        sql: RUNS[0].answer.data![0].input,
      },
    ]);
  });

  it('writes the report: cover, summary, each question with its answer and dashboard, the appendix', () => {
    const html = exportHtml(
      exportDocument({
        runs: RUNS,
        content: CONTENT,
        brand: 'halo',
        dashboards: drawn(),
      }),
    );
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Halo Workbench');
    expect(html).toContain('#ED3E13');
    expect(html).toContain(
      'Penetración de productos y coberturas en Intellify',
    );
    expect(html).toContain('Resumen');
    expect(html).toContain('Pregunta 3');
    expect(html).toContain('<strong>Medical</strong>');
    expect(html).toContain('Versión 1, reemplazada por la versión 2');
    expect(html).toContain('Dashboard · versión 2');
    expect(html).toContain('filtros: Cliente, Producto, todos en «Todos»');
    expect(html).toContain('1 (versiones 1 y 2)');
    // A table widget is an HTML table with all its rows, never an image.
    expect(html).toContain('<td>Cliente 20</td>');
    expect(html).toContain('Tablas: products, policy_coverages');
    // No SQL unless asked; raw HTML in an answer is only text.
    expect(html).not.toContain('<pre>SELECT');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('adds the SQL to the appendix when asked, and draws Mercer in its own colours', () => {
    const html = exportHtml(
      exportDocument({
        runs: RUNS,
        content: { ...CONTENT, includeSql: true },
        brand: 'mercer',
        dashboards: new Map(),
      }),
    );
    expect(html).toContain('<pre>SELECT p.name');
    expect(html).toContain('Agentic Hub');
    expect(html).toContain('#0B41AD');
    expect(html).not.toContain('#ED3E13');
  });

  it('lays out the slides: cover, summary, each turn, the dashboard rows packed, the queries', () => {
    const slides = exportSlides(
      exportDocument({
        runs: RUNS,
        content: CONTENT,
        brand: 'halo',
        dashboards: drawn(),
      }),
    );
    // Cover, summary, turn 1 (headline + table), turn 2 (v1 thumbnail),
    // turn 3: rows 1-2 on one slide... row 2 does not fit with row 1, so two
    // image slides, then the table widget, then the queries.
    expect(slides).toHaveLength(8);
    const turn1 = slides[2];
    expect(turn1.notes).toBe(RUNS[0].answer.content);
    const table = turn1.items.find((item) => item.kind === 'table');
    expect(table?.kind === 'table' && table.rows[0]).toHaveLength(6);
    expect(
      turn1.items.some(
        (item) =>
          item.kind === 'text' &&
          item.text ===
            'Primeras 2 de 2 filas y 6 de 8 columnas; la tabla completa está en las notas.',
      ),
    ).toBe(true);
    const thumbnail = slides[3];
    expect(
      thumbnail.items.filter((item) => item.kind === 'image'),
    ).toHaveLength(1);
    expect(
      thumbnail.items.some(
        (item) =>
          item.kind === 'text' &&
          item.text === 'Versión 1, reemplazada por la versión 2',
      ),
    ).toBe(true);
    // Every image fits the 5.1 in band of a slide.
    for (const slide of slides) {
      const images = slide.items.filter((item) => item.kind === 'image');
      const height = images.reduce(
        (sum, item) => sum + (item.kind === 'image' ? item.h : 0),
        0,
      );
      expect(height).toBeLessThanOrEqual(5.1 + 0.1);
    }
    // The table widget: a native table of its first 12 rows, with a note.
    const widget = slides[6];
    const native = widget.items.find((item) => item.kind === 'table');
    expect(native?.kind === 'table' && native.rows).toHaveLength(13);
    expect(
      widget.items.some(
        (item) =>
          item.kind === 'text' && item.text === 'Primeras 12 de 20 filas',
      ),
    ).toBe(true);
    const queries = slides[7];
    expect(
      queries.items.some(
        (item) =>
          item.kind === 'text' && item.text === 'Cómo se obtuvieron los datos',
      ),
    ).toBe(true);
  });

  it('drops a headline too long for one line at 26 pt to 20 pt', () => {
    const headlineSize = (headline: string): number | undefined => {
      const slides = exportSlides(
        exportDocument({
          runs: RUNS,
          content: {
            ...CONTENT,
            turns: CONTENT.turns.map((turn, k) =>
              k === 0 ? { ...turn, headline } : turn,
            ),
          },
          brand: 'halo',
          dashboards: drawn(),
        }),
      );
      const item = slides[2].items.find(
        (i) => i.kind === 'text' && i.text === headline,
      );
      return item?.kind === 'text' ? item.size : undefined;
    };
    expect(headlineSize('Unas 12 métricas comparan los 11 productos')).toBe(26);
    expect(
      headlineSize(
        'Los 38 clientes tienen de media 6,3 de 11 productos (58% de penetración)',
      ),
    ).toBe(20);
  });

  it('reads an answer’s first markdown table and a statement’s tables', () => {
    expect(firstMarkdownTable(RUNS[0].answer.content)?.rows[0][0]).toBe(
      'Medical',
    );
    expect(firstMarkdownTable('No table here.')).toBeUndefined();
    expect(
      tablesOfSql(
        'SELECT * FROM "wc"."public"."matches" m JOIN goals g ON 1=1',
      ),
    ).toEqual(['matches', 'goals']);
  });
});
