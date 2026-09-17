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
  scopedStyle,
  FRAME_SCRIPT_FILENAME,
  FRAME_SELECT_SCRIPT,
  sandboxedVisualizationDocument,
  storedVisualizationDocument,
  VisualContext,
} from './visualization-document';
import type { ReasoningStep } from './entities/project.entity';

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
