// `marked` and `sanitize-html` pull in ESM-only dependencies; these specs are
// about the frame scaffolding, not the markdown pipeline, so stub both.
jest.mock('marked', () => ({
  marked: { parse: (markdown: string) => `<p>${markdown}</p>` },
}));
jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: (html: string) => html,
}));
// The runtime is a large generated string; these specs only care that the
// document ships it, so a marker stands in for it.
jest.mock('./visual-runtime', () => ({
  VISUAL_RUNTIME_FILENAME: 'qti-chart.js',
  VISUAL_RUNTIME_SCRIPT: '/* runtime */',
}));

import {
  BLANK_RENDER_MESSAGE,
  scopedStyle,
  FRAME_SCRIPT_FILENAME,
  FRAME_SELECT_SCRIPT,
  sandboxedVisualizationDocument,
  storedVisualizationDocument,
  VisualContext,
} from './visualization-document';
import { VISUAL_RUNTIME_FILENAME } from './visual-runtime';
import type { VisualSpec } from './visual-spec';
import type { ReasoningStep } from './entities/project.entity';

const bundle = {
  title: 'Claims by payer',
  description: 'Aetna leads.',
  html: '<div id="chart"></div>',
  css: '.chart { color: red; }',
  javascript: 'document.getElementById("chart").textContent = "hi";',
};

const spec: VisualSpec = {
  spec: 1,
  chart: {
    form: 'bar',
    select: ['payer', 'claims'],
    x: 'payer',
    y: 'claims',
  },
};

/** The same visual, spec-rendered: synthetic body, empty sheet, bootstrap. */
const specBundle = {
  title: 'Claims by payer',
  description: 'Aetna leads.',
  html: '<div id="qti-chart-root"></div>',
  css: '',
  javascript: 'window.qtiChart.mount();',
  spec,
};

describe('sandboxed document blank-render watchdog', () => {
  const document = sandboxedVisualizationDocument(bundle);

  it('posts the agreed blank message after load', () => {
    expect(BLANK_RENDER_MESSAGE).toBe('visual rendered blank');
    expect(document).toContain(`post("${BLANK_RENDER_MESSAGE}")`);
    expect(document).toContain("window.addEventListener('load'");
    expect(document).toContain('setTimeout(checkBlank, 1500)');
  });

  it('checks the visual section for rendered content', () => {
    expect(document).toContain("document.querySelector('.qti-visual')");
    expect(document).toContain(
      "section.querySelector('svg, canvas, table, img')",
    );
    expect(document).toContain('children[i].offsetHeight >= 24');
  });

  it('suppresses the blank report once a real error was posted', () => {
    expect(document).toContain('if (reported) return;');
    expect(document).toContain('reported = true;');
  });
});

describe('frame select bridge', () => {
  it('is inlined in the sandboxed document ahead of the designer script', () => {
    const document = sandboxedVisualizationDocument(bundle);

    expect(document).toContain(FRAME_SELECT_SCRIPT);
    expect(document.indexOf(FRAME_SELECT_SCRIPT)).toBeLessThan(
      document.indexOf(bundle.javascript),
    );
  });

  it('posts visual-select through window.qti.select and data-qti-value marks', () => {
    expect(FRAME_SELECT_SCRIPT).toContain("type: 'visual-select'");
    expect(FRAME_SELECT_SCRIPT).toContain('window.qti.select = select;');
    expect(FRAME_SELECT_SCRIPT).toContain("getAttribute('data-qti-value')");
    expect(FRAME_SELECT_SCRIPT).toContain("getAttribute('data-qti-label')");
    expect(FRAME_SELECT_SCRIPT).toContain(
      "document.addEventListener('click', fire)",
    );
    expect(FRAME_SELECT_SCRIPT).toContain("event.key !== 'Enter'");
  });

  it('loads from a file in the stored document, which forbids inline script', () => {
    const document = storedVisualizationDocument(bundle);

    expect(document).toContain("script-src 'self'");
    expect(document).toContain(
      `<script src="${FRAME_SCRIPT_FILENAME}"></script>`,
    );
    expect(document).not.toContain('window.qti.select');
    expect(document.indexOf(FRAME_SCRIPT_FILENAME)).toBeLessThan(
      document.indexOf('script.js'),
    );
  });

  it('keeps the runtime hooks out of the stored document', () => {
    const document = storedVisualizationDocument(bundle);

    expect(document).not.toContain(BLANK_RENDER_MESSAGE);
    expect(document).not.toContain('visual-error');
  });
});

describe('injected qti-data block', () => {
  const chartData = [
    {
      tool: 'run_readonly_sql',
      input: 'SELECT month, n FROM main.health.claims',
      columns: ['month', 'n'],
      rowCount: 1,
      rows: [{ month: '2024-01', n: 5 }],
    },
  ];

  it('embeds the bounded records as a JSON script block ahead of the other scripts', () => {
    const document = sandboxedVisualizationDocument(bundle, {
      chartData,
    });

    expect(document).toContain('<script type="application/json" id="qti-data">');
    expect(document.indexOf('id="qti-data"')).toBeLessThan(
      document.indexOf(FRAME_SELECT_SCRIPT),
    );
    expect(document).toContain(JSON.stringify(chartData));
  });

  it('defaults to an empty array when no chart data is supplied', () => {
    const document = sandboxedVisualizationDocument(bundle);

    expect(document).toContain('<script type="application/json" id="qti-data">[]</script>');
  });

  it('escapes a closing script tag inside the data so the document stays intact', () => {
    const malicious = [
      { tool: 'run_readonly_sql', rows: [{ note: '</script>alert(1)' }] },
    ];
    const document = sandboxedVisualizationDocument(bundle, {
      chartData: malicious,
    });

    expect(document).not.toContain('"note":"</script>alert(1)"');
    expect(document).toContain('"note":"<\\/script>alert(1)"');
  });

  it('is also inlined (not blocked by CSP) in the stored, script-src self document', () => {
    const document = storedVisualizationDocument(bundle, { chartData });

    expect(document).toContain('<script type="application/json" id="qti-data">');
    expect(document).toContain(JSON.stringify(chartData));
    expect(document.indexOf('id="qti-data"')).toBeLessThan(
      document.indexOf(FRAME_SCRIPT_FILENAME),
    );
  });
});

describe('spec-rendered documents', () => {
  const chartData = [
    {
      tool: 'run_readonly_sql',
      columns: ['payer', 'claims'],
      rows: [{ payer: 'Aetna', claims: 5 }],
    },
  ];

  it('inlines the spec, the runtime and the bootstrap in the sandboxed document', () => {
    const document = sandboxedVisualizationDocument(specBundle, { chartData });

    expect(document).toContain(
      `<script type="application/json" id="qti-spec">${JSON.stringify(spec)}</script>`,
    );
    expect(document).toContain('/* runtime */');
    expect(document).toContain('window.qtiChart.mount();');
    // Order: data → spec → error hook → frame bridge → runtime → bootstrap.
    expect(document.indexOf('id="qti-data"')).toBeLessThan(
      document.indexOf('id="qti-spec"'),
    );
    expect(document.indexOf('id="qti-spec"')).toBeLessThan(
      document.indexOf(FRAME_SELECT_SCRIPT),
    );
    expect(document.indexOf(FRAME_SELECT_SCRIPT)).toBeLessThan(
      document.indexOf('/* runtime */'),
    );
    expect(document.indexOf('/* runtime */')).toBeLessThan(
      document.indexOf('window.qtiChart.mount();'),
    );
    // The frame still reports failures for a spec visual.
    expect(document).toContain(BLANK_RENDER_MESSAGE);
  });

  it('renders the runtime mount point as the visual body', () => {
    const document = sandboxedVisualizationDocument(specBundle);

    expect(document).toContain(
      '<div class="qti-visual-body">\n<div id="qti-chart-root"></div>',
    );
  });

  it('references the runtime as a file in the stored, script-src self document', () => {
    const document = storedVisualizationDocument(specBundle, { chartData });

    expect(document).toContain("script-src 'self'");
    expect(document).toContain(`<script src="${VISUAL_RUNTIME_FILENAME}"></script>`);
    expect(document).toContain('id="qti-spec"');
    // Never inlined there: the CSP would block it.
    expect(document).not.toContain('/* runtime */');
    // Frame bridge → runtime → bootstrap (script.js).
    expect(document.indexOf(FRAME_SCRIPT_FILENAME)).toBeLessThan(
      document.indexOf(VISUAL_RUNTIME_FILENAME),
    );
    expect(document.indexOf(VISUAL_RUNTIME_FILENAME)).toBeLessThan(
      document.indexOf('script.js'),
    );
  });

  it('escapes a closing script tag inside the spec', () => {
    const document = sandboxedVisualizationDocument({
      ...specBundle,
      spec: {
        ...spec,
        chart: { ...spec.chart, xLabel: '</script><script>alert(1)</script>' },
      },
    });

    expect(document).not.toContain('"xLabel":"</script>');
    expect(document).toContain('"xLabel":"<\\/script>');
  });

  it('ships no spec block or runtime for a freeform visual', () => {
    expect(sandboxedVisualizationDocument(bundle)).not.toContain('id="qti-spec"');
    expect(sandboxedVisualizationDocument(bundle)).not.toContain('/* runtime */');
    expect(storedVisualizationDocument(bundle)).not.toContain('id="qti-spec"');
    expect(storedVisualizationDocument(bundle)).not.toContain(
      `<script src="${VISUAL_RUNTIME_FILENAME}"></script>`,
    );
  });
});

describe('frame bridge data + refresh API', () => {
  it('exposes window.qti.data, onRefresh, and a qti-data message listener', () => {
    expect(FRAME_SELECT_SCRIPT).toContain("getElementById('qti-data')");
    expect(FRAME_SELECT_SCRIPT).toContain('window.qti.data = initialData;');
    expect(FRAME_SELECT_SCRIPT).toContain('window.qti.onRefresh = function (cb)');
    expect(FRAME_SELECT_SCRIPT).toContain("message.type === 'qti-data'");
    expect(FRAME_SELECT_SCRIPT).toContain('pristineData = message.data;');
  });
});

describe('frame bridge dashboard filtering', () => {
  it('handles qti-filter messages against the pristine (unfiltered) copy', () => {
    expect(FRAME_SELECT_SCRIPT).toContain("message.type === 'qti-filter'");
    expect(FRAME_SELECT_SCRIPT).toContain('Array.isArray(message.filters)');
    expect(FRAME_SELECT_SCRIPT).toContain('activeFilters = message.filters;');
    expect(FRAME_SELECT_SCRIPT).toContain('var pristineData = initialData;');
    expect(FRAME_SELECT_SCRIPT).toContain('var applyFilters = function ()');
    expect(FRAME_SELECT_SCRIPT).toContain('if (!activeFilters.length) return pristineData;');
  });

  it('ANDs multiple filters and skips records that lack the filtered column', () => {
    expect(FRAME_SELECT_SCRIPT).toContain('recordHasColumn(record, f.column)');
    expect(FRAME_SELECT_SCRIPT).toContain(
      "(f.values || []).indexOf(String(row[f.column])) !== -1",
    );
    expect(FRAME_SELECT_SCRIPT).toContain('applicable.every(function (f)');
  });

  it('re-applies filters on top of a fresh qti-data refresh', () => {
    // pristineData is reassigned from the refresh, then filters recompute
    // window.qti.data — a refresh never bypasses an active filter.
    expect(FRAME_SELECT_SCRIPT.indexOf('pristineData = message.data;')).toBeGreaterThan(
      FRAME_SELECT_SCRIPT.indexOf("message.type === 'qti-data'"),
    );
    expect(FRAME_SELECT_SCRIPT).toContain('setData(applyFilters());');
  });

  it('includes the mark\'s data-qti-column in the visual-select payload', () => {
    expect(FRAME_SELECT_SCRIPT).toContain("getAttribute('data-qti-column')");
    expect(FRAME_SELECT_SCRIPT).toContain(
      'column: column === null || column === undefined ? undefined : String(column)',
    );
  });
});

describe('"How this was worked out" reasoning section', () => {
  const steps: ReasoningStep[] = [
    {
      step: 1,
      rationale: 'Checked which payer had the most denied claims last quarter.',
      tool: 'run_readonly_sql',
      input: 'SELECT payer, count(*) FROM main.health.claims',
      rowCount: 1240,
    },
    {
      step: 2,
      rationale: 'Tried to break it down by region but the table lacked one.',
      tool: 'run_readonly_sql',
      input: 'SELECT region FROM main.health.claims',
      error: 'column "region" does not exist',
    },
  ];

  it('renders one ordered item per step with an escaped rationale and outcome', () => {
    const document = storedVisualizationDocument(bundle, { reasoning: steps });

    expect(document).toContain('How this was worked out');
    expect(document).toContain(
      'Checked which payer had the most denied claims last quarter.',
    );
    expect(document).toContain('1,240 rows');
    expect(document).toContain(
      'Tried to break it down by region but the table lacked one.',
    );
    expect(document).toContain(
      'failed — column &quot;region&quot; does not exist',
    );
  });

  it('places the section between Analysis and the data provenance', () => {
    const context: VisualContext = {
      answer: 'Aetna leads in denials.',
      reasoning: steps,
      data: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT payer, count(*) FROM main.health.claims',
          columns: ['payer'],
          rows: [{ payer: 'Aetna' }],
          rowCount: 1,
        },
      ],
    };
    const document = storedVisualizationDocument(bundle, context);

    const analysisIndex = document.indexOf('Analysis');
    const reasoningIndex = document.indexOf('How this was worked out');
    const provenanceIndex = document.indexOf('Data used');
    expect(analysisIndex).toBeGreaterThan(-1);
    expect(reasoningIndex).toBeGreaterThan(analysisIndex);
    expect(provenanceIndex).toBeGreaterThan(reasoningIndex);
  });

  it('never runs the rationale through the markdown renderer', () => {
    const document = storedVisualizationDocument(bundle, {
      reasoning: [
        {
          step: 1,
          rationale: '<script>alert(1)</script> & "quoted"',
          tool: 'run_readonly_sql',
        },
      ],
    });

    expect(document).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;',
    );
    expect(document).not.toContain('<script>alert(1)</script>');
  });

  it('omits the section entirely when there are no reasoning steps', () => {
    const document = storedVisualizationDocument(bundle, { reasoning: [] });

    expect(document).not.toContain('How this was worked out');
  });

  it('omits the section when reasoning is absent altogether', () => {
    const document = storedVisualizationDocument(bundle);

    expect(document).not.toContain('How this was worked out');
  });
});

describe('provenance "why" line', () => {
  it("shows each record's rationale above its SQL when present", () => {
    const context: VisualContext = {
      data: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT payer, count(*) FROM main.health.claims',
          rationale: 'Started with the overall payer breakdown.',
          columns: ['payer'],
          rows: [{ payer: 'Aetna' }],
          rowCount: 1,
        },
      ],
    };
    const document = storedVisualizationDocument(bundle, context);

    const whyIndex = document.indexOf(
      'Started with the overall payer breakdown.',
    );
    const sqlIndex = document.indexOf(
      'SELECT payer, count(*) FROM main.health.claims',
    );
    expect(whyIndex).toBeGreaterThan(-1);
    expect(sqlIndex).toBeGreaterThan(whyIndex);
  });

  it('omits the why line when the record carries no rationale', () => {
    const context: VisualContext = {
      data: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT payer, count(*) FROM main.health.claims',
          columns: ['payer'],
          rows: [{ payer: 'Aetna' }],
          rowCount: 1,
        },
      ],
    };
    const document = storedVisualizationDocument(bundle, context);

    expect(document).not.toContain('class="qti-muted qti-why"');
  });
});

describe('designer stylesheet scoping', () => {
  const pageStyles = [
    ':root { --accent: #f0c674; }',
    'body { background: #121212; }',
    'section { max-width: 480px; }',
    'table { width: 100%; }',
    '@media (max-width: 600px) { body { padding: 0; } }',
  ].join('\n');

  it('confines the sheet to the designer wrapper, not the frame', () => {
    const scoped = scopedStyle(pageStyles);

    expect(scoped.startsWith('@scope (.qti-visual-body) {')).toBe(true);
    expect(scoped).toContain('section { max-width: 480px; }');
  });

  it('rewrites page-level selectors so :root custom properties survive', () => {
    const scoped = scopedStyle(pageStyles);

    expect(scoped).toContain(':scope { --accent: #f0c674; }');
    expect(scoped).toContain(':scope { background: #121212; }');
    expect(scoped).toContain(
      '@media (max-width: 600px) { :scope { padding: 0; } }',
    );
    expect(scoped).not.toContain(':root');
    expect(scoped).not.toMatch(/(^|[{}\s])body\s*\{/);
  });

  it('leaves at-rule preludes and keyframe names alone', () => {
    const scoped = scopedStyle('@keyframes bodyfade { from { opacity: 0 } }');

    expect(scoped).toContain('@keyframes bodyfade {');
  });

  it('returns nothing for an empty sheet', () => {
    expect(scopedStyle('   ')).toBe('');
  });

  it('wraps the designer html so its element selectors cannot reach the frame', () => {
    const document = storedVisualizationDocument(bundle);

    expect(document).toContain('<div class="qti-visual-body">');
    expect(document).toContain('@scope (.qti-visual-body) {');
    // Inlined scoped, never linked raw — a linked sheet would leak again.
    expect(document).not.toContain('<link rel="stylesheet" href="styles.css">');
  });

  it('scopes the sandboxed document the same way', () => {
    const document = sandboxedVisualizationDocument(bundle);

    expect(document).toContain('@scope (.qti-visual-body) {');
    expect(document).toContain('<div class="qti-visual-body">');
  });
});
