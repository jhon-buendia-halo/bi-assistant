// `marked` and `sanitize-html` pull in ESM-only dependencies; these specs are
// about the frame scaffolding, not the markdown pipeline, so stub both.
jest.mock('marked', () => ({
  marked: { parse: (markdown: string) => `<p>${markdown}</p>` },
}));
jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: (html: string) => html,
}));

import {
  BLANK_RENDER_MESSAGE,
  FRAME_SCRIPT_FILENAME,
  FRAME_SELECT_SCRIPT,
  sandboxedVisualizationDocument,
  storedVisualizationDocument,
} from './visualization-document';

const bundle = {
  title: 'Claims by payer',
  description: 'Aetna leads.',
  html: '<div id="chart"></div>',
  css: '.chart { color: red; }',
  javascript: 'document.getElementById("chart").textContent = "hi";',
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

describe('tile mode document', () => {
  const context = {
    question: 'How do claims trend?',
    answer: 'Claims rose steadily through the year.',
    entities: ['main.health.claims'],
    projectName: 'Claims',
    version: 2,
    generatedAt: '2024-01-01T00:00:00.000Z',
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'SELECT month, n FROM main.health.claims',
        columns: ['month', 'n'],
        rows: [{ month: '2024-01', n: 5 }],
        rowCount: 1,
      },
    ],
  };

  it('defaults to the full frame', () => {
    const document = sandboxedVisualizationDocument(bundle, context);

    expect(document).toContain('<main class="qti-frame">');
    expect(document).not.toContain('class="qti-frame qti-frame--tile"');
    expect(document).toContain('Analysis');
    expect(document).toContain('Data used');
    expect(document).toContain(context.question);
  });

  it('omits question, entities, takeaway, analysis, provenance and footer', () => {
    const document = sandboxedVisualizationDocument(bundle, context, {
      mode: 'tile',
    });

    expect(document).toContain('class="qti-frame qti-frame--tile"');
    expect(document).toContain(bundle.title);
    expect(document).not.toContain(context.question);
    expect(document).not.toContain('class="qti-entities"');
    expect(document).not.toContain('class="qti-takeaway"');
    expect(document).not.toContain('class="qti-prose"');
    expect(document).not.toContain('class="qti-provenance"');
    expect(document).not.toContain('class="qti-footer"');
  });

  it('still keeps the runtime-error hook and select script in a tile', () => {
    const document = sandboxedVisualizationDocument(bundle, context, {
      mode: 'tile',
    });

    expect(document).toContain(BLANK_RENDER_MESSAGE);
    expect(document).toContain(FRAME_SELECT_SCRIPT);
    expect(document).toContain("type: 'visual-select'");
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
