import {
  DOCK_DEFAULT_RATIO,
  DOCK_FALLBACK_WIDTH,
  DOCK_MIN_CANVAS,
  DOCK_MIN_WIDTH,
  dockBounds,
  dockWidth,
  readDockRatio,
  writeDockRatio,
} from './workflow-run-dock.util';

const KEY = 'qti.workflow-run-dock.width-ratio';

describe('workflow-run-dock.util', () => {
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  describe('dockBounds', () => {
    it('keeps the canvas minimum beside the dock in a wide page', () => {
      expect(dockBounds(1200)).toEqual({
        min: DOCK_MIN_WIDTH,
        max: 1200 - DOCK_MIN_CANVAS,
      });
    });

    it('never goes below the minimum width in a narrow page', () => {
      expect(dockBounds(500)).toEqual({
        min: DOCK_MIN_WIDTH,
        max: DOCK_MIN_WIDTH,
      });
    });
  });

  describe('dockWidth', () => {
    it('falls back before the room is measured', () => {
      expect(dockWidth(0, 0.5, false)).toBe(DOCK_FALLBACK_WIDTH);
      expect(dockWidth(0, 0.5, true)).toBe(DOCK_FALLBACK_WIDTH);
    });

    it('is the share of the room', () => {
      expect(dockWidth(1200, 0.5, false)).toBe(600);
    });

    it('clamps to the minimum and the maximum', () => {
      expect(dockWidth(1200, 0.05, false)).toBe(DOCK_MIN_WIDTH);
      expect(dockWidth(1200, 0.99, false)).toBe(1200 - DOCK_MIN_CANVAS);
    });

    it('is the maximum when maximized', () => {
      expect(dockWidth(1200, 0.3, true)).toBe(1200 - DOCK_MIN_CANVAS);
    });
  });

  describe('readDockRatio / writeDockRatio', () => {
    it('defaults without a kept value', () => {
      expect(readDockRatio()).toBe(DOCK_DEFAULT_RATIO);
    });

    it('ignores the former height share', () => {
      localStorage.setItem('qti.workflow-run-dock.ratio', '0.7');
      expect(readDockRatio()).toBe(DOCK_DEFAULT_RATIO);
      localStorage.removeItem('qti.workflow-run-dock.ratio');
    });

    it('ignores out-of-range and broken values', () => {
      for (const bad of ['0', '1', '1.5', '-0.2', 'abc']) {
        localStorage.setItem(KEY, bad);
        expect(readDockRatio()).toBe(DOCK_DEFAULT_RATIO);
      }
    });

    it('round-trips a share, rounded to three decimals', () => {
      writeDockRatio(0.4);
      expect(readDockRatio()).toBe(0.4);
      writeDockRatio(0.33333);
      expect(readDockRatio()).toBe(0.333);
    });
  });
});
