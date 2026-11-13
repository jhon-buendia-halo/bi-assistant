/**
 * The sizes of the workflow page's two resizable panels (ui.md 4.4b): the
 * Run panel (the Chat) on the right, sized by its width, and the Logs under
 * the canvas, sized by their height. Each is kept as a share of the room it
 * shares with the canvas.
 */
export interface DockSize {
  /** Its least size. */
  min: number;
  /** What the canvas side keeps at least. */
  minOther: number;
  /** Its share of the room before any drag. */
  defaultRatio: number;
  /** Its size before the room is measured. */
  fallback: number;
  storageKey: string;
}

/** The Run panel, beside the canvas and the Logs: a width. */
export const RUN_DOCK: DockSize = {
  min: 360,
  minOther: 480,
  defaultRatio: 0.32,
  fallback: 380,
  storageKey: 'qti.workflow-run-dock.width-ratio',
};

/** The Logs, under the canvas: a height. */
export const LOGS_DOCK: DockSize = {
  min: 160,
  minOther: 200,
  defaultRatio: 0.4,
  fallback: 320,
  storageKey: 'qti.workflow-logs-dock.ratio',
};

/** Arrow keys on a panel's edge. */
export const DOCK_KEY_STEP = 24;

/** The sizes it may take in a room of `room` pixels. */
export function dockBounds(
  room: number,
  size: DockSize,
): { min: number; max: number } {
  const max = Math.max(size.min, room - size.minOther);
  return { min: Math.min(size.min, max), max };
}

/**
 * Its size: maximized, all but the canvas side's minimum; else its share of
 * the room, within the bounds. A room not yet measured gives the fallback.
 */
export function dockSize(
  room: number,
  ratio: number,
  maximized: boolean,
  size: DockSize,
): number {
  if (room <= 0) return size.fallback;
  const { min, max } = dockBounds(room, size);
  if (maximized) return max;
  return Math.round(Math.min(max, Math.max(min, ratio * room)));
}

/** The kept share, else the default; a broken or out-of-range value is ignored. */
export function readDockRatio(size: DockSize): number {
  try {
    const value = Number(localStorage.getItem(size.storageKey));
    return value > 0 && value < 1 ? value : size.defaultRatio;
  } catch {
    return size.defaultRatio;
  }
}

export function writeDockRatio(size: DockSize, ratio: number): void {
  try {
    localStorage.setItem(
      size.storageKey,
      String(Math.round(ratio * 1000) / 1000),
    );
  } catch {
    // Storage unavailable: the size is kept for this page only.
  }
}
