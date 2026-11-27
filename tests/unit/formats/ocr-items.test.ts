import { describe, expect, it } from 'vitest';
import {
  fixConfusables,
  holdsText,
  ocrLinesToItems,
  pictureCandidates,
  removeRules,
  uncoveredText,
  type OcrLine,
  type OcrWord,
  type Raster,
} from '../../../src/formats/ocr';

const H = 20;

function line(words: [string, number, number, number?][], y = 100): OcrLine {
  const ws: OcrWord[] = words.map(([text, x0, x1, confidence = 90]) => ({
    text,
    confidence,
    bbox: { x0, y0: y - H, x1, y1: y },
  }));
  return {
    words: ws,
    bbox: { x0: ws[0].bbox.x0, y0: y - H, x1: ws.at(-1)!.bbox.x1, y1: y },
    baseline: { x0: ws[0].bbox.x0, y0: y, x1: ws.at(-1)!.bbox.x1, y1: y },
    rowAttributes: { rowHeight: H },
  };
}

function raster(w: number, h: number, rects: [number, number, number, number, number][]): Raster {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1, v] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

const word = (text: string, confidence: number, x0: number, y0: number, x1: number, y1: number): OcrWord => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1 },
});

describe('ocr helpers', () => {
  it('joins Latin words, rejoins split numbers, and splits wide gaps or walls', () => {
    expect(
      ocrLinesToItems([line([['Invoice', 0, 70], ['No.:', 76, 110], ['INV-0457', 116, 200]])], 1, 1000).map((it) => it.text),
    ).toEqual(['Invoice No.: INV-0457']);

    expect(ocrLinesToItems([line([['98765-', 0, 60], ['43210', 62, 120]])], 1, 1000).map((it) => it.text)).toEqual([
      '98765-43210',
    ]);

    const items = ocrLinesToItems(
      [line([['Email', 0, 40], ['rahul@acme.example', 120, 260]])],
      1,
      1000,
    );
    expect(items.map((it) => it.text)).toEqual(['Email', 'rahul@acme.example']);
    expect(items[1].x).toBe(120);
  });

  it('converts canvas pixels to PDF points with baseline y', () => {
    const l = line([['Typography', 200, 400]], 306);
    l.baseline = { x0: 0, y0: 300, x1: 1000, y1: 310 };
    const [it] = ocrLinesToItems([l], 2, 842);
    expect(it).toEqual({ text: 'Typography', x: 100, y: 842 - 302 / 2, fontSize: H / 2, width: 100 });
  });

  it('repairs OCR digit confusables in valid phones and Luhn cards without touching ordinary text', () => {
    expect(fixConfusables('Phone +91-9876S-432IO')).toBe('Phone +91-98765-43210');
    expect(fixConfusables('Card 4lll-1111-1111-1111')).toBe('Card 4111-1111-1111-1111');
    expect(fixConfusables('INV-2026-10-0457 rahul@acme.example')).toBe('INV-2026-10-0457 rahul@acme.example');
  });

  it('removes rules, identifies non-text pictures, and detects uncovered text gaps', () => {
    const img = raster(300, 120, [
      [0, 60, 300, 62, 0],
      [150, 10, 170, 40, 0],
    ]);
    removeRules(img, 80);
    expect(img.data[(60 * 300 + 200) * 4]).toBe(255);
    expect(img.data[(20 * 300 + 160) * 4]).toBe(0);

    const picPage = raster(600, 600, [[96, 96, 312, 252, 90]]);
    expect(pictureCandidates(picPage, [])).toHaveLength(1);
    expect(pictureCandidates(picPage, [word('98765', 92, 150, 150, 220, 170)])).toHaveLength(0);
    expect(holdsText({ x0: 0, y0: 0, x1: 200, y1: 200 }, [word('Sample', 90, 10, 10, 80, 40)])).toBe(true);

    const glyphs: [number, number, number, number, number][] = [100, 140, 180, 220, 260].map((x) => [x, 100, x + 24, 124, 0]);
    const gapPage = raster(600, 600, glyphs);
    expect(uncoveredText(gapPage, [], [])).toHaveLength(1);
    expect(uncoveredText(gapPage, [{ x0: 95, y0: 95, x1: 290, y1: 130 }], [])).toEqual([]);
  });
});
