import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type Tesseract from 'tesseract.js';
import type { PdfCheckbox, PdfFill, PdfPicture, PdfRule, Rgb } from '../core/types';
import {
  eraseRules,
  estimateSkew,
  findCheckboxes,
  findFills,
  findRules,
  lineOrientation,
  paperTone,
  textColour,
} from './layout-scan';
import type { PdfPage, PdfTextItem } from './pdf';
import { readBlobBytes } from './segments';

export interface OcrProgress {
  stage: 'engine' | 'recognize';
  step?: 'orient' | 'read' | 'layout';
  page: number;
  pages: number;
  progress: number;
  thumbnail?: string;
}

export interface OcrOptions {
  signal?: AbortSignal;
  onProgress?: (p: OcrProgress) => void;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Box;
}

export interface OcrLine {
  words: OcrWord[];
  bbox: Box;
  baseline?: Box;
  rowAttributes?: { rowHeight: number };
}

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const RENDER_SCALE = 3;
const MAX_SIDE = 4000;
const THUMB_WIDTH = 160;
const SPLIT_GAP = 1.5;
const SPACE_GAP = 0.8;
const NUMBER_GAP = 0.2;
const MIN_SYMBOL_CONFIDENCE = 60;
const SYMBOLS_ONLY = /^[^\p{L}\p{N}]+$/u;
const RULE_CHARS = /[|｜_＿=~]/u;
const EDGE_NOISE = /^[|｜]+|[|｜]+$|^[“"]+(?=[A-Za-z0-9])|(?<=[A-Za-z0-9.])[”"]+$/gu;

const AS_DIGIT: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  i: '1',
  '|': '1',
  Z: '2',
  z: '2',
  S: '5',
  s: '5',
  G: '6',
  B: '8',
  g: '9',
  q: '9',
};

const NUMBER_LIKE = /(?<![0-9A-Za-z|])[+]?[0-9A-Za-z|][0-9A-Za-z|-]{7,18}(?![0-9A-Za-z|])/g;
const PHONE_RE = /^(?:\+?91[- ]?[6-9]\d{4}[- ]?\d{5}|0?[6-9]\d{9}|(?:\+?1[- ]?)?[2-9]\d{2}[- ]?\d{3}[- ]?\d{4})$/;
const toDigits = (s: string): string => s.replace(/./g, (c) => AS_DIGIT[c] ?? c);

function isLuhnDigits(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || /^0+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Repairs OCR digit confusables (O->0, l/I->1, S->5) only when the resulting
 * token validates as a phone number or Luhn-valid credit card.
 */
export function fixConfusables(text: string): string {
  return text.replace(NUMBER_LIKE, (token) => {
    const bare = token.replace(/[+-]/g, '');
    if (!/[A-Za-z|]/.test(bare) || (bare.match(/\d/g)?.length ?? 0) < bare.length * 0.55) {
      return token;
    }
    const candidate = toDigits(token);
    if (!/^[+\d-]+$/.test(candidate)) return token;
    const digitsOnly = candidate.replace(/\D/g, '');
    if (PHONE_RE.test(candidate) || isLuhnDigits(digitsOnly)) {
      return candidate;
    }
    return token;
  });
}

const ASCENT = 0.88;
const DESCENT = 0.12;

function separateLines(items: PdfTextItem[]): void {
  for (const a of items) {
    for (const b of items) {
      const pitch = b.y - a.y;
      if (
        pitch <= Math.min(a.fontSize, b.fontSize) * 0.3 ||
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= 1
      ) {
        continue;
      }
      const need = ASCENT * a.fontSize + DESCENT * b.fontSize;
      if (need <= pitch) continue;
      const lower = (pitch - DESCENT * b.fontSize) / ASCENT;
      if (lower >= a.fontSize * 0.6) {
        a.fontSize = lower;
      } else {
        [a.fontSize, b.fontSize] = [(a.fontSize * pitch) / need, (b.fontSize * pitch) / need];
      }
    }
  }
}

export function ocrLinesToItems(
  lines: OcrLine[],
  scale: number,
  pageHeight: number,
  { colourOf, walls = [] }: { colourOf?: (box: Box) => Rgb | undefined; walls?: Box[] } = {},
): PdfTextItem[] {
  const items: PdfTextItem[] = [];

  for (const line of lines) {
    const h = line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0;
    const words = line.words
      .filter((w) => {
        const t = w.text.trim();
        return !(SYMBOLS_ONLY.test(t) && (RULE_CHARS.test(t) || w.confidence < MIN_SYMBOL_CONFIDENCE));
      })
      .map((w) => ({ ...w, text: w.text.trim().replace(EDGE_NOISE, '') }))
      .filter((w) => w.text.length > 0);
    const bl = line.baseline;
    const baselineAt = (x: number): number =>
      bl && bl.x1 > bl.x0
        ? bl.y0 + ((x - bl.x0) * (bl.y1 - bl.y0)) / (bl.x1 - bl.x0)
        : line.bbox.y1;

    let run: OcrWord[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      let text = run[0].text;
      for (let i = 1; i < run.length; i += 1) {
        const a = run[i - 1];
        const b = run[i];
        const gap = b.bbox.x0 - a.bbox.x1;
        const number = /[\d-]$/.test(a.text) && /^[\d-]/.test(b.text) && gap < NUMBER_GAP * h;
        text += (!number || gap > SPACE_GAP * h ? ' ' : '') + b.text;
      }
      const first = run[0].bbox;
      const tallest = Math.max(...run.map((w) => w.bbox.y1 - w.bbox.y0));
      const bottom = Math.max(...run.map((w) => w.bbox.y1));
      const color = colourOf?.({
        x0: first.x0,
        y0: Math.min(...run.map((w) => w.bbox.y0)),
        x1: run.at(-1)!.bbox.x1,
        y1: bottom,
      });
      items.push({
        ...(color && { color }),
        text: fixConfusables(text),
        x: first.x0 / scale,
        y: pageHeight - Math.min(baselineAt(first.x0), bottom) / scale,
        fontSize: Math.min(h, tallest * 1.2) / scale,
        width: (run.at(-1)!.bbox.x1 - first.x0) / scale,
      });
      run = [];
    };

    const walled = (a: Box, b: Box): boolean =>
      walls.some(
        (v) =>
          v.x0 >= a.x1 - h * 0.2 &&
          v.x1 <= b.x0 + h * 0.2 &&
          v.y0 < Math.max(a.y1, b.y1) &&
          v.y1 > Math.min(a.y0, b.y0),
      );

    for (const w of words) {
      const prev = run.at(-1);
      if (prev && (w.bbox.x0 - prev.bbox.x1 > SPLIT_GAP * h || walled(prev.bbox, w.bbox))) {
        flush();
      }
      run.push(w);
    }
    flush();
  }

  separateLines(items);
  return items;
}

const luminance = (d: Uint8ClampedArray, i: number): number =>
  (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

export function deepenColour(img: Raster): void {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const chroma =
      Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, luminance(data, i) - chroma / 2);
  }
}

export function removeRules(
  img: Raster,
  minRun = Math.max(80, Math.round(img.width * 0.05)),
): void {
  const { data, width: w, height: h } = img;
  const dark = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) dark[p] = luminance(data, p * 4) < 160 ? 1 : 0;
  const erase = new Uint8Array(w * h);
  const mark = (p: number): void => {
    if (p >= 0 && p < w * h) erase[p] = 1;
  };

  for (let y = 0; y < h; y += 1) {
    let start = -1;
    for (let x = 0; x <= w; x += 1) {
      const on = x < w && dark[y * w + x] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= minRun) {
          for (let k = start; k < x; k += 1) {
            [-w, 0, w].forEach((o) => mark(y * w + k + o));
          }
        }
        start = -1;
      }
    }
  }

  for (let x = 0; x < w; x += 1) {
    let start = -1;
    for (let y = 0; y <= h; y += 1) {
      const on = y < h && dark[y * w + x] === 1;
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= minRun) {
          for (let k = start; k < y; k += 1) {
            [-1, 0, 1].forEach((o) => {
              if (x + o >= 0 && x + o < w) mark(k * w + x + o);
            });
          }
        }
        start = -1;
      }
    }
  }

  for (let p = 0; p < w * h; p += 1) {
    if (erase[p]) data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
  }
}

const PICTURE_CELL = 12;
const MIN_PICTURE_AREA = 0.0015;
const MIN_PICTURE_CELLS = 4;
const MAX_PICTURE_ASPECT = 6;
const MIN_PICTURE_FILL = 0.35;
const MAX_PICTURE_GROWTH = 4;

const overlaps = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const area = (b: Box): number => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const intersection = (a: Box, b: Box): Box => ({
  x0: Math.max(a.x0, b.x0),
  y0: Math.max(a.y0, b.y0),
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
});

export const insidePicture = (word: Box, picture: Box): boolean =>
  area(intersection(word, picture)) >= area(word) * 0.5;

const PICTURE_TEXT_CONFIDENCE = 80;
const PICTURE_MAX_WORDS = 3;
const PICTURE_WORD_CONFIDENCE = 60;

export function holdsText(region: Box, words: OcrWord[]): boolean {
  const touching = words.filter((w) => overlaps(w.bbox, region) && /[\p{L}\p{N}]/u.test(w.text));
  return (
    touching.filter((w) => w.confidence >= PICTURE_WORD_CONFIDENCE).length >= PICTURE_MAX_WORDS ||
    touching.some(
      (w) => w.confidence >= PICTURE_TEXT_CONFIDENCE || !insidePicture(w.bbox, region),
    )
  );
}

export function pictureCandidates(img: Raster, words: OcrWord[]): Box[] {
  const { data, width: w, height: h } = img;
  const cols = Math.ceil(w / PICTURE_CELL);
  const rows = Math.ceil(h / PICTURE_CELL);
  const hist = new Uint32Array(256);
  for (let p = 0; p < w * h; p += 7) hist[Math.round(luminance(data, p * 4))] += 1;
  let seen = 0;
  let paper = 255;
  const total = hist.reduce((a, b) => a + b, 0);
  for (let v = 255; v >= 0; v -= 1) {
    seen += hist[v];
    if (seen >= total * 0.1) {
      paper = v;
      break;
    }
  }

  const ink = new Uint8Array(cols * rows);
  const tint = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let n = 0;
      let hits = 0;
      let faint = 0;
      for (let y = r * PICTURE_CELL; y < Math.min(h, (r + 1) * PICTURE_CELL); y += 2) {
        for (let x = c * PICTURE_CELL; x < Math.min(w, (c + 1) * PICTURE_CELL); x += 2) {
          const i = (y * w + x) * 4;
          const chroma =
            Math.max(data[i], data[i + 1], data[i + 2]) -
            Math.min(data[i], data[i + 1], data[i + 2]);
          const dark = paper - luminance(data, i);
          if (dark > 30 || chroma > 60) hits += 1;
          if (dark > 20 || chroma > 30) faint += 1;
          n += 1;
        }
      }
      ink[r * cols + c] = hits >= n * 0.5 ? 1 : 0;
      tint[r * cols + c] = faint >= n * 0.08 ? 1 : 0;
    }
  }

  const cellBox = (ca: number, ra: number, cb: number, rb: number): Box => ({
    x0: ca * PICTURE_CELL,
    y0: ra * PICTURE_CELL,
    x1: Math.min(w, (cb + 1) * PICTURE_CELL),
    y1: Math.min(h, (rb + 1) * PICTURE_CELL),
  });

  const canGrow = (core: Box, ca: number, ra: number, cb: number, rb: number): boolean => {
    if (ca < 0 || ra < 0 || cb >= cols || rb >= rows) return false;
    let marked = false;
    for (let r = ra; r <= rb && !marked; r += 1) {
      for (let c = ca; c <= cb && !marked; c += 1) marked = tint[r * cols + c] === 1;
    }
    const strip = cellBox(ca, ra, cb, rb);
    return marked && !words.some((wd) => overlaps(wd.bbox, strip) && !insidePicture(wd.bbox, core));
  };

  const seenCell = new Uint8Array(cols * rows);
  const out: Box[] = [];
  for (let start = 0; start < cols * rows; start += 1) {
    if (!ink[start] || seenCell[start]) continue;
    const stack = [start];
    seenCell[start] = 1;
    let count = 0;
    let [c0, r0, c1, r1] = [cols, rows, 0, 0];
    while (stack.length > 0) {
      const cell = stack.pop()!;
      const c = cell % cols;
      const r = (cell - c) / cols;
      count += 1;
      [c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c), Math.max(r1, r)];
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const [nc, nr] = [c + dc, r + dr];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const n = nr * cols + nc;
          if (ink[n] && !seenCell[n]) {
            seenCell[n] = 1;
            stack.push(n);
          }
        }
      }
    }

    const [bc, br] = [c1 - c0 + 1, r1 - r0 + 1];
    if (area(cellBox(c0, r0, c1, r1)) < w * h * MIN_PICTURE_AREA) continue;
    if (Math.min(bc, br) < MIN_PICTURE_CELLS || Math.max(bc, br) > MAX_PICTURE_ASPECT * Math.min(bc, br)) {
      continue;
    }
    if (count < bc * br * MIN_PICTURE_FILL) continue;
    if (bc > cols * 0.9 && br > rows * 0.9) continue;

    const core = cellBox(c0, r0, c1, r1);
    for (let i = 0; i < MAX_PICTURE_GROWTH; i += 1) {
      if (canGrow(core, c0 - 1, r0, c0 - 1, r1)) c0 -= 1;
      if (canGrow(core, c1 + 1, r0, c1 + 1, r1)) c1 += 1;
      if (canGrow(core, c0, r0 - 1, c1, r0 - 1)) r0 -= 1;
      if (canGrow(core, c0, r1 + 1, c1, r1 + 1)) r1 += 1;
    }
    const box = cellBox(c0, r0, c1, r1);
    if (!holdsText(box, words)) out.push(box);
  }
  return out;
}

const GAP_CELL = 8;
const GAP_MIN_ASPECT = 1.8;
const GAP_MAX_REGIONS = 12;

export function uncoveredText(img: Raster, words: Box[], skip: Box[]): Box[] {
  const { data, width: w, height: h } = img;
  const cols = Math.ceil(w / GAP_CELL);
  const rows = Math.ceil(h / GAP_CELL);
  const covered = [...words, ...skip].map((b) => ({
    x0: b.x0 - GAP_CELL,
    y0: b.y0 - GAP_CELL,
    x1: b.x1 + GAP_CELL,
    y1: b.y1 + GAP_CELL,
  }));
  const ink = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = {
        x0: c * GAP_CELL,
        y0: r * GAP_CELL,
        x1: (c + 1) * GAP_CELL,
        y1: (r + 1) * GAP_CELL,
      };
      if (covered.some((b) => overlaps(b, cell))) continue;
      let dark = false;
      for (let y = cell.y0; y < Math.min(h, cell.y1) && !dark; y += 2) {
        for (let x = cell.x0; x < Math.min(w, cell.x1) && !dark; x += 2) {
          dark = luminance(data, (y * w + x) * 4) < 150;
        }
      }
      ink[r * cols + c] = dark ? 1 : 0;
    }
  }

  const seen = new Uint8Array(cols * rows);
  const out: (Box & { cells: number })[] = [];
  for (let start = 0; start < cols * rows; start += 1) {
    if (!ink[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let cells = 0;
    let [c0, r0, c1, r1] = [cols, rows, 0, 0];
    while (stack.length > 0) {
      const cell = stack.pop()!;
      const c = cell % cols;
      const r = (cell - c) / cols;
      cells += 1;
      [c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c), Math.max(r1, r)];
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -3; dc <= 3; dc += 1) {
          const [nc, nr] = [c + dc, r + dr];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const n = nr * cols + nc;
          if (ink[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    const box = {
      x0: c0 * GAP_CELL,
      y0: r0 * GAP_CELL,
      x1: Math.min(w, (c1 + 1) * GAP_CELL),
      y1: Math.min(h, (r1 + 1) * GAP_CELL),
      cells,
    };
    const [bw, bh] = [box.x1 - box.x0, box.y1 - box.y0];
    if (bh < 16 || bh > 200 || bw < 32 || cells < 6) continue;
    if (bw < bh * GAP_MIN_ASPECT || bw * bh > w * h * 0.1) continue;
    out.push(box);
  }
  return out
    .sort((a, b) => b.cells - a.cells)
    .slice(0, GAP_MAX_REGIONS)
    .map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
}

async function renderPage(
  page: PDFPageProxy,
  deg = 0,
): Promise<{ canvas: HTMLCanvasElement; scale: number; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(RENDER_SCALE, MAX_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const [w, h] = [Math.ceil(viewport.width), Math.ceil(viewport.height)];
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = Math.abs(Math.round(deg / 90)) % 2 === 1 ? [h, w] : [w, h];
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const [cos, sin] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const transform = [
    cos,
    sin,
    -sin,
    cos,
    canvas.width / 2 - (cos * w - sin * h) / 2,
    canvas.height / 2 - (sin * w + cos * h) / 2,
  ];
  await page.render({
    canvasContext: ctx,
    viewport,
    ...(deg !== 0 && { transform }),
  }).promise;
  return { canvas, scale, width: base.width, height: base.height };
}

function thumbnailOf(canvas: HTMLCanvasElement): string {
  const t = document.createElement('canvas');
  t.width = THUMB_WIDTH;
  t.height = Math.round((THUMB_WIDTH * canvas.height) / canvas.width);
  t.getContext('2d')!.drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.7);
}

function crop(src: HTMLCanvasElement, b: Box, zoom = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const [w, h] = [Math.max(1, Math.round(b.x1 - b.x0)), Math.max(1, Math.round(b.y1 - b.y0))];
  [c.width, c.height] = [w * zoom, h * zoom];
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, b.x0, b.y0, w, h, 0, 0, c.width, c.height);
  return c;
}

const pad = (b: Box, by: number, w: number, h: number): Box => ({
  x0: Math.max(0, b.x0 - by),
  y0: Math.max(0, b.y0 - by),
  x1: Math.min(w, b.x1 + by),
  y1: Math.min(h, b.y1 + by),
});

const linesOf = (data: Tesseract.Page): OcrLine[] =>
  (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;

function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const quarter = Math.abs(deg % 180) === 90;
  const c = document.createElement('canvas');
  [c.width, c.height] = quarter ? [src.height, src.width] : [src.width, src.height];
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

const pixelsOf = (c: HTMLCanvasElement): ImageData =>
  c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
const readable = (w: OcrWord): boolean => /[\p{L}\p{N}]/u.test(w.text);
const confidenceOf = (lines: OcrLine[]): number => {
  const words = lines.flatMap((l) => l.words).filter(readable);
  return words.length ? mean(words.map((w) => w.confidence)) : 0;
};

const MIN_SKEW = 0.1;
const READ_SKEW = 1;
const UPSIDE_DOWN_CONFIDENCE = 60;
const GAP_COVER_CONFIDENCE = 30;
const GAP_WORD_CONFIDENCE = 60;

/**
 * Recognizes scanned image-only PDF pages locally in the browser using self-hosted
 * English Tesseract assets (`/ocr/*`) with zero external CDN requests.
 */
export async function recognizePdf(
  pdf: PDFDocumentProxy,
  { signal, onProgress }: OcrOptions = {},
): Promise<PdfPage[]> {
  const abortError = (): DOMException => new DOMException('OCR cancelled', 'AbortError');
  if (signal?.aborted) throw abortError();

  let fail!: (e: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    fail = reject;
  });
  aborted.catch(() => {});
  signal?.addEventListener('abort', () => fail(abortError()), { once: true });
  const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, aborted]);

  const pages = pdf.numPages;
  let page = 0;
  let thumbnail: string | undefined;
  onProgress?.({ stage: 'engine', page, pages, progress: 0 });

  const { createWorker, OEM, PSM } = (await race(import('tesseract.js'))).default;
  const assets = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href;
  const starting = createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${assets}worker.min.js`,
    corePath: `${assets}core/`,
    langPath: `${assets}lang`,
    cacheMethod: 'none',
    logger: (m) => {
      if (page > 0 && m.status === 'recognizing text') {
        onProgress?.({
          stage: 'recognize',
          page,
          pages,
          progress: (page - 1 + m.progress) / pages,
          thumbnail,
        });
      }
    },
  });

  try {
    const worker = await race(starting);
    const out: PdfPage[] = [];

    for (page = 1; page <= pages; page += 1) {
      const pdfPage = await race(pdf.getPage(page));
      const rendered = await race(renderPage(pdfPage));
      const { scale } = rendered;
      thumbnail = thumbnailOf(rendered.canvas);
      const report = (step: OcrProgress['step'], done = 0): void =>
        onProgress?.({
          stage: 'recognize',
          step,
          page,
          pages,
          progress: (page - 1 + done) / pages,
          thumbnail,
        });
      report('orient');

      let canvas = rendered.canvas;
      const turn = lineOrientation(pixelsOf(canvas)) === 'vertical' ? 90 : 0;
      if (turn) canvas = rotateCanvas(canvas, turn);
      const skew = estimateSkew(pixelsOf(canvas));
      let level: HTMLCanvasElement | undefined;
      if (Math.abs(skew) >= READ_SKEW) {
        if (canvas !== rendered.canvas) canvas.width = canvas.height = 0;
        canvas = (await race(renderPage(pdfPage, turn - skew))).canvas;
      } else if (Math.abs(skew) >= MIN_SKEW) {
        level = (await race(renderPage(pdfPage, turn - skew))).canvas;
      }

      const firstPass = async (source: HTMLCanvasElement) => {
        const pixels = pixelsOf(source);
        const rules = findRules(pixels);
        const cleaned = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
        deepenColour(cleaned);
        removeRules(cleaned);
        eraseRules(
          cleaned,
          rules.filter((r) => r.dashed),
        );
        const textCanvas = document.createElement('canvas');
        [textCanvas.width, textCanvas.height] = [source.width, source.height];
        textCanvas.getContext('2d')!.putImageData(cleaned, 0, 0);
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }));
        const lines = linesOf((await race(worker.recognize(textCanvas, {}, { blocks: true }))).data);
        return {
          canvas: source,
          pixels,
          rules,
          cleaned,
          text: textCanvas,
          lines,
          confidence: confidenceOf(lines),
        };
      };

      report('read');
      let pass = await firstPass(canvas);
      if (pass.confidence < UPSIDE_DOWN_CONFIDENCE) {
        const turned = await firstPass(rotateCanvas(canvas, 180));
        if (turned.confidence > pass.confidence + 15) {
          pass = turned;
          if (level) level = rotateCanvas(level, 180);
        }
      }

      const { pixels, rules, cleaned, text, lines } = pass;
      canvas = pass.canvas;
      const [width, height] = [canvas.width / scale, canvas.height / scale];
      const candidates = pictureCandidates(
        pixels,
        lines.flatMap((l) => l.words),
      );
      const gaps = uncoveredText(
        cleaned,
        lines.flatMap((l) =>
          l.words.filter((w) => w.confidence >= GAP_COVER_CONFIDENCE).map((w) => w.bbox),
        ),
        candidates,
      );

      const readAt = async (area: Box, zoom = 1): Promise<OcrLine[]> => {
        const shift = (b: Box): Box => ({
          x0: b.x0 / zoom + area.x0,
          y0: b.y0 / zoom + area.y0,
          x1: b.x1 / zoom + area.x0,
          y1: b.y1 / zoom + area.y0,
        });
        return linesOf(
          (await race(worker.recognize(crop(text, area, zoom), {}, { blocks: true }))).data,
        ).map((l) => ({
          words: l.words.map((w) => ({ ...w, bbox: shift(w.bbox) })),
          bbox: shift(l.bbox),
          baseline: l.baseline && shift(l.baseline),
          rowAttributes: l.rowAttributes && { rowHeight: l.rowAttributes.rowHeight / zoom },
        }));
      };

      const clear = (found: OcrLine[]): boolean =>
        found.some((l) => l.words.some((w) => w.confidence >= GAP_WORD_CONFIDENCE));

      if (gaps.length > 0) {
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }));
        for (const gap of gaps) {
          const region = pad(gap, 8, text.width, text.height);
          let found = await readAt(region);
          if (!clear(found) && lines.every((l) => l.words.every((w) => !overlaps(w.bbox, region)))) {
            found = await readAt(region, 2);
          }
          for (const line of found) {
            if (!clear([line])) continue;
            const read = line.words.filter((w) => w.confidence >= GAP_WORD_CONFIDENCE / 2);
            const words = read.filter((n) =>
              lines.every((l) =>
                l.words.every((w) => !overlaps(n.bbox, w.bbox) || w.confidence < n.confidence),
              ),
            );
            if (words.length === 0) continue;
            for (const l of lines) {
              l.words = l.words.filter((w) => !words.some((n) => overlaps(n.bbox, w.bbox)));
            }
            lines.push({ ...line, words });
          }
        }
      }

      const pictures: PdfPicture[] = [];
      if (candidates.length > 0) {
        await race(worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }));
        for (const box of candidates) {
          const found = linesOf(
            (await race(worker.recognize(crop(canvas, box), {}, { blocks: true }))).data,
          ).flatMap((l) => l.words);
          if (holdsText({ x0: 0, y0: 0, x1: box.x1 - box.x0, y1: box.y1 - box.y0 }, found)) continue;
          for (const line of lines) {
            line.words = line.words.filter((w) => !insidePicture(w.bbox, box));
          }
          const blob = await race(
            new Promise<Blob | null>((r) => crop(canvas, box).toBlob(r, 'image/jpeg', 0.9)),
          );
          if (!blob) continue;
          pictures.push({
            x: box.x0 / scale,
            y: height - box.y1 / scale,
            width: (box.x1 - box.x0) / scale,
            height: (box.y1 - box.y0) / scale,
            jpeg: await readBlobBytes(blob),
            keep: true,
          });
        }
      }

      report('layout', 0.9);
      const straight = level ? pixelsOf(level) : pixels;
      const straightRules = level ? findRules(straight) : rules;
      const [cx, cy, cos, sin] = [
        canvas.width / 2,
        canvas.height / 2,
        Math.cos((skew * Math.PI) / 180),
        Math.sin((skew * Math.PI) / 180),
      ];
      const back = (x: number, y: number): [number, number] =>
        level
          ? [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]
          : [x, y];
      const moved = <T extends Box>(b: T): T => {
        const [mx, my] = back((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
        const [hw, hh] = [(b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2];
        return { ...b, x0: mx - hw, y0: my - hh, x1: mx + hw, y1: my + hh };
      };

      const textHeight =
        median(lines.map((l) => l.rowAttributes?.rowHeight || l.bbox.y1 - l.bbox.y0)) || 30;
      const boxes = findCheckboxes(straight, textHeight)
        .map(moved)
        .filter((b) => !candidates.some((c) => overlaps(c, b)));

      const inPicture = (b: Box): boolean => candidates.some((c) => overlaps(c, b));
      const paper = paperTone(pixels);
      const toPt = {
        x: (v: number) => v / scale,
        y: (v: number) => height - v / scale,
        len: (v: number) => v / scale,
      };
      const ruled = straightRules
        .map((r) => {
          const [[x1, y1], [x2, y2]] = [back(r.x1, r.y1), back(r.x2, r.y2)];
          const half = r.thickness / 2;
          return {
            ...r,
            x1,
            y1,
            x2,
            y2,
            box: {
              x0: Math.min(x1, x2) - half,
              y0: Math.min(y1, y2) - half,
              x1: Math.max(x1, x2) + half,
              y1: Math.max(y1, y2) + half,
            },
          };
        })
        .filter((r) => !inPicture(r.box));

      const pageRules: PdfRule[] = ruled.map((r) => ({
        x1: toPt.x(r.x1),
        y1: toPt.y(r.y1),
        x2: toPt.x(r.x2),
        y2: toPt.y(r.y2),
        width: Math.max(0.4, toPt.len(r.thickness)),
        color: r.color,
        ...(r.dashed && { dashed: true }),
      }));

      const fills: PdfFill[] = findFills(straight, straightRules)
        .map(moved)
        .filter((f) => !inPicture(f))
        .map((f) => ({
          x: toPt.x(f.x0),
          y: toPt.y(f.y1),
          width: toPt.len(f.x1 - f.x0),
          height: toPt.len(f.y1 - f.y0),
          color: f.color,
        }));

      const checkboxes: PdfCheckbox[] = boxes.map((b) => ({
        x: toPt.x(b.x0),
        y: toPt.y(b.y1),
        size: toPt.len(b.x1 - b.x0),
        checked: b.checked,
        color: b.color,
      }));

      const walls = [
        ...boxes,
        ...ruled.filter((r) => Math.abs(r.x2 - r.x1) < Math.abs(r.y2 - r.y1)).map((r) => r.box),
      ];
      const items = ocrLinesToItems(lines, scale, height, {
        colourOf: (box) => textColour(pixels, box, paper),
        walls,
      });

      canvas.width =
        canvas.height =
        text.width =
        text.height =
        rendered.canvas.width =
        rendered.canvas.height =
          0;
      if (level) level.width = level.height = 0;

      out.push({ width, height, items, pictures, rules: pageRules, fills, checkboxes });
      report('layout', 1);
    }

    return out;
  } finally {
    starting.then((w) => w.terminate()).catch(() => {});
  }
}
