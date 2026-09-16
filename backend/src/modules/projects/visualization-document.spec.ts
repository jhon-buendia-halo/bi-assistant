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
