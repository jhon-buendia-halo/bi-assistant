import {
  LOGS_DOCK,
  RUN_DOCK,
  dockBounds,
  dockSize,
  readDockRatio,
  writeDockRatio,
} from './workflow-run-dock.util';

describe('workflow-run-dock.util', () => {
  const keys = [RUN_DOCK.storageKey, LOGS_DOCK.storageKey];
  beforeEach(() => keys.forEach((k) => localStorage.removeItem(k)));
  afterEach(() => keys.forEach((k) => localStorage.removeItem(k)));

  describe('dockBounds', () => {
    it('keeps the canvas side minimum in a roomy page', () => {
      expect(dockBounds(1200, RUN_DOCK)).toEqual({
        min: RUN_DOCK.min,
        max: 1200 - RUN_DOCK.minOther,
      });
      expect(dockBounds(800, LOGS_DOCK)).toEqual({
        min: LOGS_DOCK.min,
        max: 800 - LOGS_DOCK.minOther,
      });
    });

    it('never goes below the minimum in a small page', () => {
      expect(dockBounds(500, RUN_DOCK)).toEqual({
        min: RUN_DOCK.min,
        max: RUN_DOCK.min,
      });
    });
  });

  describe('dockSize', () => {
    it('falls back before the room is measured', () => {
      expect(dockSize(0, 0.5, false, RUN_DOCK)).toBe(RUN_DOCK.fallback);
      expect(dockSize(0, 0.5, true, LOGS_DOCK)).toBe(LOGS_DOCK.fallback);
    });

    it('is the share of the room', () => {
      expect(dockSize(1200, 0.4, false, RUN_DOCK)).toBe(480);
      expect(dockSize(800, 0.5, false, LOGS_DOCK)).toBe(400);
    });

    it('clamps to the minimum and the maximum', () => {
      expect(dockSize(1200, 0.05, false, RUN_DOCK)).toBe(RUN_DOCK.min);
      expect(dockSize(1200, 0.99, false, RUN_DOCK)).toBe(
        1200 - RUN_DOCK.minOther,
      );
    });

    it('is the maximum when maximized', () => {
      expect(dockSize(1200, 0.3, true, RUN_DOCK)).toBe(
        1200 - RUN_DOCK.minOther,
      );
    });
  });

  describe('readDockRatio / writeDockRatio', () => {
    it('defaults without a kept value', () => {
      expect(readDockRatio(RUN_DOCK)).toBe(RUN_DOCK.defaultRatio);
      expect(readDockRatio(LOGS_DOCK)).toBe(LOGS_DOCK.defaultRatio);
    });

    it('ignores out-of-range and broken values', () => {
      for (const bad of ['0', '1', '1.5', '-0.2', 'abc']) {
        localStorage.setItem(RUN_DOCK.storageKey, bad);
        expect(readDockRatio(RUN_DOCK)).toBe(RUN_DOCK.defaultRatio);
      }
    });

    it('round-trips a share per panel, rounded to three decimals', () => {
      writeDockRatio(RUN_DOCK, 0.4);
      writeDockRatio(LOGS_DOCK, 0.33333);
      expect(readDockRatio(RUN_DOCK)).toBe(0.4);
      expect(readDockRatio(LOGS_DOCK)).toBe(0.333);
    });
  });
});
