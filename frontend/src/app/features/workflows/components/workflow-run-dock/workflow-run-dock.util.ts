/** The Run panel's share of the page width under the header, before any drag. */
export const DOCK_DEFAULT_RATIO = 0.45;
/** Its least width; the canvas keeps at least `DOCK_MIN_CANVAS` beside it. */
export const DOCK_MIN_WIDTH = 420;
export const DOCK_MIN_CANVAS = 280;
/** Arrow Left / Right on its left edge. */
export const DOCK_KEY_STEP = 24;
/** Its width before the page room is measured. */
export const DOCK_FALLBACK_WIDTH = 520;

const STORAGE_KEY = 'qti.workflow-run-dock.width-ratio';

/** The widths it may take in a room of `room` pixels. */
export function dockBounds(room: number): { min: number; max: number } {
  const max = Math.max(DOCK_MIN_WIDTH, room - DOCK_MIN_CANVAS);
  return { min: Math.min(DOCK_MIN_WIDTH, max), max };
}

/**
 * Its width: maximized, all but the canvas's minimum; else its share of the
 * room, within the bounds. A room not yet measured gives the fallback.
 */
export function dockWidth(
  room: number,
  ratio: number,
  maximized: boolean,
): number {
  if (room <= 0) return DOCK_FALLBACK_WIDTH;
  const { min, max } = dockBounds(room);
  if (maximized) return max;
  return Math.round(Math.min(max, Math.max(min, ratio * room)));
}

/** The kept share, else the default; a broken or out-of-range value is ignored. */
export function readDockRatio(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return value > 0 && value < 1 ? value : DOCK_DEFAULT_RATIO;
  } catch {
    return DOCK_DEFAULT_RATIO;
  }
}

export function writeDockRatio(ratio: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(ratio * 1000) / 1000));
  } catch {
    // Storage unavailable: the width is kept for this page only.
  }
}
