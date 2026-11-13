import {
  DOCK_DEFAULT_RATIO,
  DOCK_FALLBACK_HEIGHT,
  DOCK_MIN_CANVAS,
  DOCK_MIN_HEIGHT,
  dockBounds,
  dockHeight,
  readDockRatio,
  writeDockRatio,
} from './workflow-run-dock.util';

describe('workflow-run-dock.util', () => {
  beforeEach(() => localStorage.removeItem('qti.workflow-run-dock.ratio'));
  afterEach(() => localStorage.removeItem('qti.workflow-run-dock.ratio'));

  describe('dockBounds', () => {
    it('keeps the canvas minimum above the dock in a roomy page', () => {
      expect(dockBounds(800)).toEqual({
        min: DOCK_MIN_HEIGHT,
        max: 800 - DOCK_MIN_CANVAS,
      });
    });

    it('never goes below the minimum height in a short page', () => {
      expect(dockBounds(300)).toEqual({ min: DOCK_MIN_HEIGHT, max: DOCK_MIN_HEIGHT });
    });
  });

  describe('dockHeight', () => {
    it('falls back before the room is measured', () => {
      expect(dockHeight(0, 0.5, false)).toBe(DOCK_FALLBACK_HEIGHT);
      expect(dockHeight(0, 0.5, true)).toBe(DOCK_FALLBACK_HEIGHT);
    });

    it('is the share of the room', () => {
      expect(dockHeight(800, 0.5, false)).toBe(400);
    });

    it('clamps to the minimum and the maximum', () => {
      expect(dockHeight(800, 0.05, false)).toBe(DOCK_MIN_HEIGHT);
      expect(dockHeight(800, 0.99, false)).toBe(800 - DOCK_MIN_CANVAS);
    });

    it('is the maximum when maximized', () => {
      expect(dockHeight(800, 0.3, true)).toBe(800 - DOCK_MIN_CANVAS);
    });
  });

  describe('readDockRatio / writeDockRatio', () => {
    it('defaults without a kept value', () => {
      expect(readDockRatio()).toBe(DOCK_DEFAULT_RATIO);
    });

    it('ignores out-of-range and broken values', () => {
      for (const bad of ['0', '1', '1.5', '-0.2', 'abc']) {
        localStorage.setItem('qti.workflow-run-dock.ratio', bad);
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
