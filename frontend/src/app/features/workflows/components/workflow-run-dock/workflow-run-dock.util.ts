/**
 * The sizes of the workflow page's resizable panels (ui.md 4.4b): the Run
 * panel (the Chat) on the right, sized by its width, and the node dialog's
 * chat pane. A panel's size is kept as a share of the room it shares with
 * the canvas.
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

/** The Run panel, beside the canvas: a width. */
export const RUN_DOCK: DockSize = {
  min: 360,
  minOther: 480,
  defaultRatio: 0.32,
  fallback: 380,
  storageKey: 'qti.workflow-run-dock.width-ratio',
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

/**
 * The chat pane of an agent step's node dialog (ui.md 4.4b): a width in
 * pixels, beside the artifact, kept as dragged across openings.
 */
export const NODE_CHAT_PANE = {
  min: 320,
  /** Its largest share of the dialog's body. */
  maxShare: 0.6,
  /** What the artifact keeps at least. */
  minOther: 480,
  defaultWidth: 400,
  storageKey: 'qti.workflow-ndv-chat.width',
} as const;

/** The widths the chat pane may take in a dialog body `room` pixels wide. */
export function nodeChatBounds(room: number): { min: number; max: number } {
  const { min, maxShare, minOther } = NODE_CHAT_PANE;
  const max = Math.max(
    min,
    Math.floor(Math.min(room * maxShare, room - minOther)),
  );
  return { min, max };
}

/** Its width: the wanted one within the bounds; as wanted before the room is measured. */
export function nodeChatWidth(room: number, wanted: number): number {
  if (room <= 0) return wanted;
  const { min, max } = nodeChatBounds(room);
  return Math.round(Math.min(max, Math.max(min, wanted)));
}

/** The kept width, else the default; a broken or too small value is ignored. */
export function readNodeChatWidth(): number {
  try {
    const value = Number(localStorage.getItem(NODE_CHAT_PANE.storageKey));
    return Number.isFinite(value) && value >= NODE_CHAT_PANE.min
      ? value
      : NODE_CHAT_PANE.defaultWidth;
  } catch {
    return NODE_CHAT_PANE.defaultWidth;
  }
}

export function writeNodeChatWidth(width: number): void {
  try {
    localStorage.setItem(NODE_CHAT_PANE.storageKey, String(Math.round(width)));
  } catch {
    // Storage unavailable: the width is kept while the dialog is open.
  }
}
