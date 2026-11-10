import { Component, computed, input } from '@angular/core';
import {
  NO_PREVIEW,
  VISUAL_PREVIEW_KEYS,
} from '../../models/visual-chart.model';

interface Cell {
  x: number;
  y: number;
  o: number;
}

/** Cells of a cols × rows grid with a fixed, varied opacity per cell. */
function grid(
  cols: number,
  rows: number,
  x0: number,
  y0: number,
  stepX: number,
  stepY: number,
  value: (c: number, r: number) => number,
): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: x0 + c * stepX, y: y0 + r * stepY, o: value(c, r) });
    }
  }
  return cells;
}

const CALENDAR = grid(12, 7, 9.75, 7, 8.5, 8.5, (c, r) =>
  r > 4
    ? 0.12 + ((c * 3 + r) % 3) * 0.08
    : 0.15 + ((c * 7 + r * 13 + c * r) % 9) / 10.5,
);

const HEATMAP = grid(8, 5, 10.5, 7.75, 12.5, 11.5, (c, r) => {
  // A smooth hot spot towards the upper right, so it reads as a heatmap.
  const d = Math.hypot(c - 5.5, r - 1.2);
  return Math.max(0.12, Math.min(1, 1 - d / 6.5));
});

const STRIP = [18, 36, 54].flatMap((y, row) =>
  Array.from({ length: 9 }, (_, i) => ({
    x: 18 + row * 6 + ((i * 29 + row * 17) % 74),
    y: y + (((i * 7) % 5) - 2) * 1.4,
  })),
);

const SCATTER = Array.from({ length: 12 }, (_, i) => ({
  x: 20 + i * 7.6,
  y: 56 - i * 3.4 + (((i * 37) % 11) - 5) * 1.3,
}));

const HISTOGRAM = [8, 18, 32, 46, 52, 38, 22, 10].map((h, i) => ({
  x: 16 + i * 11,
  y: 64 - h,
  h,
}));

/**
 * A small, text-free thumbnail of a chart type (Visuals library, roadmap
 * 1.21.12). Colours come from the theme tokens, so it reads in light and
 * dark. An unknown key draws the neutral 'none' placeholder.
 */
@Component({
  selector: 'app-visual-preview',
  templateUrl: './visual-preview.html',
  styleUrl: './visual-preview.scss',
})
export class VisualPreview {
  readonly previewKey = input<string | null>(NO_PREVIEW);

  readonly key = computed(() => {
    const value = this.previewKey();
    return value !== null &&
      (VISUAL_PREVIEW_KEYS as readonly string[]).includes(value)
      ? value
      : NO_PREVIEW;
  });

  readonly calendar = CALENDAR;
  readonly heatmap = HEATMAP;
  readonly strip = STRIP;
  readonly scatter = SCATTER;
  readonly histogram = HISTOGRAM;
}
