import { describe, expect, it } from 'vitest';
import {
  estimateSkew,
  findCheckboxes,
  findFills,
  findRules,
  lineOrientation,
  textColour,
} from '../../../src/formats/layout-scan';
import type { Raster } from '../../../src/formats/ocr';

type Rect = [number, number, number, number, [number, number, number]];

function raster(w: number, h: number, rects: Rect[], paper = 246): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set([paper, paper, paper, 255], p * 4);
  for (const [x0, y0, x1, y1, c] of rects) {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        data.set([...c, 255], (y * w + x) * 4);
      }
    }
  }
  return { data, width: w, height: h };
}

const BLACK: [number, number, number] = [30, 30, 30];
const textLine = (x: number, y: number, n: number, c = BLACK): Rect[] =>
  Array.from({ length: n }, (_, k): Rect[] => [
    [x + k * 24, y, x + k * 24 + 18, y + 3, c],
    [x + k * 24 + 8, y, x + k * 24 + 11, y + 20, c],
  ]).flat();

describe('layout-scan', () => {
  it('finds solid and dashed rules without matching text strokes', () => {
    const img = raster(400, 300, [
      [20, 50, 380, 53, [90, 90, 90]],
      [40, 80, 42, 280, BLACK],
      ...textLine(60, 120, 10),
    ]);
    const rules = findRules(img, 80);
    expect(rules).toHaveLength(2);
    expect(rules.find((r) => r.y1 === r.y2)).toMatchObject({
      x1: 20,
      x2: 380,
      y1: 51,
      thickness: 3,
      dashed: false,
    });

    const dashes: Rect[] = Array.from({ length: 20 }, (_, k): Rect => [20 + k * 14, 200, 28 + k * 14, 202, BLACK]);
    const dashed = findRules(raster(400, 300, [...dashes, ...textLine(20, 60, 12)]), 80);
    expect(dashed).toHaveLength(1);
    expect(dashed[0]).toMatchObject({ dashed: true, y1: 200.5 });
  });

  it('finds shaded header cells and ignores whole-page tints', () => {
    const grey: [number, number, number] = [228, 228, 228];
    const img = raster(400, 200, [
      [40, 40, 360, 80, grey],
      ...textLine(60, 50, 8),
      [38, 38, 362, 40, BLACK],
      [38, 80, 362, 82, BLACK],
    ]);
    const fills = findFills(img, findRules(img, 80));
    expect(fills).toHaveLength(1);
    expect(fills[0].color.every((v) => Math.abs(v - 228) <= 3)).toBe(true);
    expect(findFills(raster(200, 200, [[0, 0, 200, 200, [235, 230, 215]]]))).toEqual([]);
  });

  it('extracts text colour and detects empty/checked checkboxes', () => {
    const img = raster(200, 60, [
      ...textLine(10, 10, 3, [29, 63, 154]),
      ...textLine(110, 10, 3, [40, 44, 38]),
    ]);
    const blue = textColour(img, { x0: 0, y0: 0, x1: 90, y1: 40 })!;
    expect(blue[2]).toBeGreaterThan(blue[0] + 60);

    const frame = (x: number, y: number, s: number): Rect[] => [
      [x, y, x + s, y + 3, BLACK],
      [x, y + s - 3, x + s, y + s, BLACK],
      [x, y, x + 3, y + s, BLACK],
      [x + s - 3, y, x + s, y + s, BLACK],
    ];
    const stroke = (x0: number, y0: number, x1: number, y1: number): Rect[] =>
      Array.from({ length: 21 }, (_, k): Rect => {
        const [x, y] = [Math.round(x0 + ((x1 - x0) * k) / 20), Math.round(y0 + ((y1 - y0) * k) / 20)];
        return [x - 2, y - 2, x + 2, y + 2, BLACK];
      });
    const tick = [...stroke(87, 44, 94, 53), ...stroke(94, 53, 114, 22)];
    const boxes = findCheckboxes(raster(300, 120, [...frame(20, 30, 30), ...frame(80, 30, 30), ...tick]), 30);
    expect(boxes.map((b) => [b.x0, b.y0, b.checked])).toEqual([
      [20, 30, false],
      [80, 30, true],
    ]);
  });

  it('estimates page skew and horizontal vs vertical orientation', () => {
    const page = (deg: number, turned = false) => {
      const [w, h] = turned ? [600, 800] : [800, 600];
      const rects: Rect[] = [];
      const a = (deg * Math.PI) / 180;
      for (let line = 0; line < 12; line++) {
        for (let k = 0; k < 40; k++) {
          const [x, y] = [100 + k * 15, 80 + line * 36];
          const [cx, cy] = [x - 400 + ((k * 7) % 3), y - 300];
          let [rx, ry] = [cx * Math.cos(a) - cy * Math.sin(a) + 400, cx * Math.sin(a) + cy * Math.cos(a) + 300];
          if (turned) [rx, ry] = [600 - ry, rx];
          rects.push([Math.round(rx), Math.round(ry), Math.round(rx) + (turned ? 14 : 10), Math.round(ry) + (turned ? 10 : 14), BLACK]);
        }
      }
      return raster(w, h, rects);
    };

    expect(estimateSkew(page(0))).toBeCloseTo(0, 0);
    expect(Math.abs(estimateSkew(page(3)) - 3)).toBeLessThanOrEqual(0.3);
    expect(lineOrientation(page(0))).toBe('horizontal');
    expect(lineOrientation(page(0, true))).toBe('vertical');
  });
});
