import { marked, type Token, type Tokens } from 'marked';
import PDFDocument from 'pdfkit';

/**
 * The RFP document as PDF (api.md 2.16.5 I31, plan 1.4): the Markdown is
 * tokenised with `marked`'s lexer and drawn with pdfkit's built-in Helvetica
 * (no font files): headings, paragraphs, bullet and numbered lists, and
 * tables with fixed column widths and a shaded header row; a page break
 * before every top-level (`##`) section but the first. A plain rendering,
 * not a design artefact. Deterministic: the creation date is an input, and
 * pdfkit derives the file id from it.
 */

export interface PdfOptions {
  title: string;
  /** Written as the creation and modification date. */
  createdAt: Date;
  /** Deflate the content streams (default true; tests turn it off). */
  compress?: boolean;
}

const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
  code: 'Courier',
};
const SIZE = { h1: 20, h2: 15, h3: 12, body: 10, table: 8.5 };
const MARGIN = 54;
const HEADER_FILL = '#E5E7EB';
const RULE = '#9CA3AF';
const TEXT = '#111827';

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** Inline tokens as styled runs (links keep their text). */
function runs(
  tokens: Token[] | undefined,
  style: Omit<Run, 'text'> = {},
): Run[] {
  const out: Run[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        out.push(
          ...runs((token as Tokens.Strong).tokens, { ...style, bold: true }),
        );
        break;
      case 'em':
        out.push(
          ...runs((token as Tokens.Em).tokens, { ...style, italic: true }),
        );
        break;
      case 'del':
      case 'link':
        out.push(...runs((token as Tokens.Link).tokens, style));
        break;
      case 'codespan':
        out.push({
          ...style,
          code: true,
          text: (token as Tokens.Codespan).text,
        });
        break;
      case 'br':
        out.push({ ...style, text: '\n' });
        break;
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) out.push(...runs(t.tokens, style));
        else out.push({ ...style, text: t.text });
        break;
      }
      default:
        out.push({
          ...style,
          text: (token as { text?: string }).text ?? token.raw,
        });
    }
  }
  return out;
}

const plain = (tokens: Token[] | undefined): string =>
  runs(tokens)
    .map((r) => r.text)
    .join('');

function fontOf(run: Run): string {
  if (run.code) return FONT.code;
  if (run.bold && run.italic) return FONT.boldItalic;
  if (run.bold) return FONT.bold;
  if (run.italic) return FONT.italic;
  return FONT.regular;
}

type Doc = PDFKit.PDFDocument;

class Renderer {
  private sectionCount = 0;

  constructor(private readonly doc: Doc) {}

  private get left(): number {
    return this.doc.page.margins.left;
  }

  private get width(): number {
    const page = this.doc.page;
    return page.width - page.margins.left - page.margins.right;
  }

  private get bottom(): number {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  /** Writes runs as one flowing paragraph at `x` with `width`. */
  private paragraph(
    parts: Run[],
    size: number,
    x: number,
    width: number,
  ): void {
    const items = parts.filter((r) => r.text !== '');
    if (!items.length) return;
    items.forEach((run, index) => {
      this.doc.font(fontOf(run)).fontSize(size).fillColor(TEXT);
      const options = { width, continued: index < items.length - 1 };
      if (index === 0) this.doc.text(run.text, x, this.doc.y, options);
      else this.doc.text(run.text, options);
    });
  }

  render(tokens: Token[]): void {
    for (const token of tokens) this.block(token);
  }

  private block(token: Token): void {
    const doc = this.doc;
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading;
        if (heading.depth === 2) {
          if (this.sectionCount > 0) doc.addPage();
          this.sectionCount += 1;
        }
        const size =
          heading.depth === 1
            ? SIZE.h1
            : heading.depth === 2
              ? SIZE.h2
              : SIZE.h3;
        if (doc.y + size * 3 > this.bottom) doc.addPage();
        doc.moveDown(heading.depth === 3 ? 0.4 : 0.2);
        this.paragraph(
          runs(heading.tokens, { bold: true }),
          size,
          this.left,
          this.width,
        );
        doc.moveDown(0.4);
        break;
      }
      case 'paragraph':
        this.paragraph(
          runs((token as Tokens.Paragraph).tokens),
          SIZE.body,
          this.left,
          this.width,
        );
        doc.moveDown(0.5);
        break;
      case 'list':
        this.list(token as Tokens.List);
        doc.moveDown(0.4);
        break;
      case 'table':
        this.table(token as Tokens.Table);
        doc.moveDown(0.6);
        break;
      case 'code':
        this.paragraph(
          [{ text: (token as Tokens.Code).text, code: true }],
          SIZE.body - 1,
          this.left + 12,
          this.width - 12,
        );
        doc.moveDown(0.5);
        break;
      case 'blockquote':
        for (const inner of (token as Tokens.Blockquote).tokens)
          this.block(inner);
        break;
      case 'hr':
        doc
          .moveTo(this.left, doc.y)
          .lineTo(this.left + this.width, doc.y)
          .strokeColor(RULE)
          .lineWidth(0.5)
          .stroke();
        doc.moveDown(0.5);
        break;
      case 'space':
        break;
      default: {
        const raw = (token as { text?: string }).text ?? token.raw;
        if (raw.trim()) {
          this.paragraph(
            [{ text: raw.trim() }],
            SIZE.body,
            this.left,
            this.width,
          );
          doc.moveDown(0.5);
        }
      }
    }
  }

  private list(list: Tokens.List): void {
    const indent = 16;
    const start = typeof list.start === 'number' ? list.start : 1;
    list.items.forEach((item, index) => {
      const marker = list.ordered ? `${start + index}.` : '•';
      if (this.doc.y + SIZE.body * 2 > this.bottom) this.doc.addPage();
      const y = this.doc.y;
      this.doc
        .font(FONT.regular)
        .fontSize(SIZE.body)
        .fillColor(TEXT)
        .text(marker, this.left, y, { width: indent - 2, lineBreak: false });
      const content = item.tokens.flatMap((t) =>
        t.type === 'text' || t.type === 'paragraph'
          ? runs((t as Tokens.Text).tokens ?? [t])
          : [{ text: plain([t]) }],
      );
      this.doc.y = y; // the item's text starts on the marker's line
      this.paragraph(
        content,
        SIZE.body,
        this.left + indent,
        this.width - indent,
      );
      this.doc.moveDown(0.15);
    });
  }

  private table(table: Tokens.Table): void {
    const doc = this.doc;
    const columns = table.header.length;
    const colWidth = this.width / columns;
    const pad = 3;
    const header = table.header.map((c) => plain(c.tokens));
    const rows = table.rows.map((row) => row.map((c) => plain(c.tokens)));

    const heightOf = (cells: string[], bold: boolean) => {
      doc.font(bold ? FONT.bold : FONT.regular).fontSize(SIZE.table);
      return (
        Math.max(
          ...cells.map((text) =>
            doc.heightOfString(text || ' ', { width: colWidth - pad * 2 }),
          ),
        ) +
        pad * 2
      );
    };

    const drawRow = (cells: string[], bold: boolean, y: number, h: number) => {
      if (bold) {
        doc.rect(this.left, y, this.width, h).fill(HEADER_FILL);
      }
      doc
        .rect(this.left, y, this.width, h)
        .strokeColor(RULE)
        .lineWidth(0.5)
        .stroke();
      cells.forEach((text, i) => {
        const x = this.left + i * colWidth;
        if (i > 0) {
          doc
            .moveTo(x, y)
            .lineTo(x, y + h)
            .strokeColor(RULE)
            .lineWidth(0.5)
            .stroke();
        }
        doc
          .font(bold ? FONT.bold : FONT.regular)
          .fontSize(SIZE.table)
          .fillColor(TEXT)
          .text(text, x + pad, y + pad, { width: colWidth - pad * 2 });
      });
    };

    let y = doc.y;
    const headerHeight = heightOf(header, true);
    if (y + headerHeight * 2 > this.bottom) {
      doc.addPage();
      y = doc.y;
    }
    drawRow(header, true, y, headerHeight);
    y += headerHeight;
    for (const row of rows) {
      const h = heightOf(row, false);
      if (y + h > this.bottom) {
        doc.addPage();
        y = doc.y;
        drawRow(header, true, y, headerHeight);
        y += headerHeight;
      }
      drawRow(row, false, y, h);
      y += h;
    }
    doc.x = this.left;
    doc.y = y;
  }
}

/** Renders `markdown` as a PDF. */
export function renderPdf(
  markdown: string,
  options: PdfOptions,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: MARGIN,
    compress: options.compress ?? true,
    info: {
      Title: options.title,
      Author: 'Intellify RFP API',
      Creator: 'Intellify RFP API',
      Producer: 'Intellify RFP API',
      CreationDate: options.createdAt,
      ModDate: options.createdAt,
    },
  });
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      new Renderer(doc).render(marked.lexer(markdown));
      doc.end();
    } catch (error) {
      reject(error as Error);
    }
  });
}
