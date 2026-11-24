/**
 * The conversation export's drawing (ADR-0056): the machine's own Edge or
 * Chrome (`launchSiteBrowser`, ADR-0049) draws each dashboard version and
 * cuts it into one PNG per widget row, and prints the HTML report as the
 * PDF; pptxgenjs writes the PowerPoint from the slides of
 * ./export-document.ts. The browser is a seam (`ExportBrowserLauncher`) so
 * the service is tested without one.
 */
import PptxGenJS from 'pptxgenjs';
import type { Browser } from 'playwright-core';
import {
  NO_BROWSER_MESSAGE,
  launchSiteBrowser,
} from '../site-review/site-browser';
import { NO_EXPORT_BROWSER_MESSAGE } from './conversation-export.contract';
import type {
  DashboardRowCapture,
  ExportPalette,
  SlideSpec,
} from './export-document';

/** The browser, open for one export. */
export interface ExportBrowserSession {
  /**
   * A dashboard document drawn at 1280 px: one capture per widget row (the
   * first alone with `firstRowOnly`), its table widgets as text.
   */
  captureDashboard(
    document: string,
    options: { firstRowOnly: boolean },
  ): Promise<DashboardRowCapture[]>;
  /** The report printed on Letter, its footer on every page. */
  printPdf(html: string, footerHtml: string): Promise<Buffer>;
  close(): Promise<void>;
}

/** Opens the browser; throws `NO_EXPORT_BROWSER_MESSAGE` when there is none. */
export type ExportBrowserLauncher = () => Promise<ExportBrowserSession>;

/** The injection token of the launcher (tests give a fake one). */
export const EXPORT_BROWSER_LAUNCHER = 'EXPORT_BROWSER_LAUNCHER';

/** How long a drawn dashboard settles before it is cut (its charts' first paint). */
const DASHBOARD_SETTLE_MS = 1_000;

/** A widget row as the page measures it. */
interface MeasuredRow {
  clip?: { x: number; y: number; width: number; height: number };
  tables: { title: string; header: string[]; rows: string[][] }[];
}

/**
 * The dashboard's rows, measured in the page: its cards grouped by their
 * top, each row clipped around its cards that are no table, and each table
 * widget read as text (its header, then every row it shows).
 */
function measureRows(): MeasuredRow[] {
  const grid = document.querySelector('.dmk-grid-layout');
  if (!grid) return [];
  const gridBox = grid.getBoundingClientRect();
  const bands: { top: number; cards: Element[] }[] = [];
  for (const card of Array.from(
    document.querySelectorAll('.dmk-grid-layout > .dmk-card'),
  )) {
    const top = card.getBoundingClientRect().top + window.scrollY;
    const band = bands.find((b) => Math.abs(b.top - top) < 4);
    if (band) band.cards.push(card);
    else bands.push({ top, cards: [card] });
  }
  const text = (node: Element | null) =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return bands.map((band) => {
    const drawn = band.cards.filter((card) => !card.querySelector('table'));
    const tables = band.cards
      .filter((card) => card.querySelector('table'))
      .map((card) => {
        const table = card.querySelector('table');
        return {
          title: text(card.querySelector('.dmk-card-title')),
          header: Array.from(table?.querySelectorAll('thead th') ?? []).map(
            (cell) => text(cell),
          ),
          rows: Array.from(table?.querySelectorAll('tbody tr') ?? []).map(
            (row) => Array.from(row.children).map((cell) => text(cell)),
          ),
        };
      });
    if (!drawn.length) return { tables };
    const boxes = drawn.map((card) => card.getBoundingClientRect());
    const whole = drawn.length === band.cards.length;
    const left = whole ? gridBox.left : Math.min(...boxes.map((b) => b.left));
    const right = whole
      ? gridBox.right
      : Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top)) + window.scrollY;
    const bottom = Math.max(...boxes.map((b) => b.bottom)) + window.scrollY;
    return {
      clip: {
        x: Math.max(0, left - 6),
        y: Math.max(0, top - 6),
        width: right - left + 12,
        height: bottom - top + 12,
      },
      tables,
    };
  });
}

/** A session on an open browser. */
function sessionOn(browser: Browser): ExportBrowserSession {
  return {
    async captureDashboard(document, { firstRowOnly }) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        colorScheme: 'light',
      });
      try {
        const page = await context.newPage();
        await page.setContent(document, { waitUntil: 'load' });
        await page
          .waitForSelector('.dmk-grid-layout > .dmk-card', { timeout: 10_000 })
          .catch(() => undefined);
        await page.waitForTimeout(DASHBOARD_SETTLE_MS);
        const measured = await page.evaluate(measureRows);
        const rows = firstRowOnly ? measured.slice(0, 1) : measured;
        const captured: DashboardRowCapture[] = [];
        for (const row of rows) {
          captured.push({
            ...(row.clip
              ? {
                  image: {
                    png: await page.screenshot({
                      fullPage: true,
                      clip: row.clip,
                      type: 'png',
                    }),
                    width: row.clip.width,
                    height: row.clip.height,
                  },
                }
              : {}),
            tables: row.tables,
          });
        }
        return captured;
      } finally {
        await context.close();
      }
    },
    async printPdf(html, footerHtml) {
      // The report runs no script: the answers' text is only ever text.
      const context = await browser.newContext({ javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        return await page.pdf({
          format: 'Letter',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: footerHtml,
          margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
        });
      } finally {
        await context.close();
      }
    },
    close: () => browser.close(),
  };
}

/** The machine's browser, headless; the export's own message when none is installed. */
export const launchExportBrowser: ExportBrowserLauncher = async () => {
  try {
    return sessionOn(await launchSiteBrowser({ headless: true }));
  } catch (error) {
    if (error instanceof Error && error.message === NO_BROWSER_MESSAGE) {
      throw new Error(NO_EXPORT_BROWSER_MESSAGE);
    }
    throw error;
  }
};

/** The pages of a PDF: its `/Type /Page` objects. */
export function pdfPageCount(pdf: Buffer): number {
  return (
    pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0
  );
}

/** The PowerPoint of the slides: Arial, wide, a footer on every slide but the cover. */
export async function drawDeck(
  slides: readonly SlideSpec[],
  meta: { title: string; palette: ExportPalette },
): Promise<Buffer> {
  const FONT = 'Arial';
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = meta.title;
  slides.forEach((spec, index) => {
    const slide = pptx.addSlide();
    for (const item of spec.items) {
      if (item.kind === 'rect') {
        slide.addShape('rect', {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          fill: { color: item.color },
          line: { color: item.color },
        });
      } else if (item.kind === 'image') {
        slide.addImage({
          data: `image/png;base64,${item.png.toString('base64')}`,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        });
      } else if (item.kind === 'table') {
        slide.addTable(
          item.rows.map((row) =>
            row.map((cell) => ({
              text: cell.text,
              options: cell.header
                ? { bold: true, fill: { color: meta.palette.surface } }
                : {},
            })),
          ),
          {
            x: item.x,
            y: item.y,
            w: item.w,
            ...(item.colW ? { colW: item.colW } : {}),
            fontSize: item.size,
            fontFace: FONT,
            color: meta.palette.fgStrong,
            border: { type: 'solid', pt: 0.5, color: meta.palette.border },
            autoPage: false,
          },
        );
      } else {
        const options = {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          fontSize: item.size,
          color: item.color,
          bold: item.bold ?? false,
          fontFace: FONT,
          valign: 'top' as const,
          ...(item.align ? { align: item.align } : {}),
        };
        if (Array.isArray(item.text)) {
          slide.addText(
            item.text.map((line) => ({
              text: line,
              options: item.bullets
                ? { bullet: true, paraSpaceAfter: 12, breakLine: true }
                : { breakLine: true },
            })),
            options,
          );
        } else {
          slide.addText(item.text, options);
        }
      }
    }
    if (index > 0) {
      slide.addText(meta.title, {
        x: 0.5,
        y: 7.05,
        w: 9,
        h: 0.3,
        fontSize: 9,
        color: meta.palette.muted,
        fontFace: FONT,
      });
      slide.addText(String(index + 1), {
        x: 12.3,
        y: 7.05,
        w: 0.6,
        h: 0.3,
        fontSize: 9,
        color: meta.palette.muted,
        align: 'right',
        fontFace: FONT,
      });
    }
    if (spec.notes) slide.addNotes(spec.notes);
  });
  const written = await pptx.write({ outputType: 'nodebuffer' });
  if (Buffer.isBuffer(written)) return written;
  return written instanceof ArrayBuffer
    ? Buffer.from(new Uint8Array(written))
    : Buffer.from(written as Uint8Array);
}
