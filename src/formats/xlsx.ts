import JSZip from 'jszip';
import type { LoadedDocument, TextEdit, XlsxCellLayout } from '../core/types';
import { distributeEdits, readBlobBytes, type Segment } from './segments';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CellRef {
  sheetIdx: number;
  cellIdx: number;
}

interface SheetInfo {
  path: string;
  doc: Document;
}

export interface XlsxHandle {
  zip: JSZip;
  sheets: SheetInfo[];
  sharedStringsXml: string | null;
  segments: Segment[];
  cells: CellRef[];
}

function isMain(el: Element, local: string): boolean {
  return el.namespaceURI === MAIN_NS && el.localName === local;
}

function textOf(el: Element): string {
  let out = '';
  const walk = (node: Element): void => {
    if (isMain(node, 't')) {
      out += node.textContent ?? '';
      return;
    }
    if (isMain(node, 'rPh')) return;
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(el);
  return out;
}

function parseXml(xml: string, path: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Failed to parse ${path}.`);
  }
  return doc;
}

async function loadSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) return [];
  const doc = parseXml(await file.async('string'), 'xl/sharedStrings.xml');
  return Array.from(doc.documentElement.children)
    .filter((si) => isMain(si, 'si'))
    .map(textOf);
}

function cellCoords(ref: string): { row: number; col: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return { row: 0, col: 0 };
  let col = 0;
  for (const ch of match[1].toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), col };
}

async function sheetPaths(zip: JSZip): Promise<{ path: string; name: string }[]> {
  const wb = zip.file('xl/workbook.xml');
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const wbDoc = parseXml(await wb.async('string'), 'xl/workbook.xml');
    const relDoc = parseXml(await rels.async('string'), 'xl/_rels/workbook.xml.rels');
    const targets = new Map<string, string>();
    for (const r of Array.from(relDoc.documentElement.children)) {
      const id = r.getAttribute('Id');
      const target = r.getAttribute('Target');
      if (id && target) {
        targets.set(
          id,
          target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`,
        );
      }
    }
    const out: { path: string; name: string }[] = [];
    for (const s of Array.from(wbDoc.getElementsByTagNameNS(MAIN_NS, 'sheet'))) {
      const rid = s.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      );
      const p = rid ? targets.get(rid) : undefined;
      if (p && zip.file(p)) {
        out.push({ path: p, name: s.getAttribute('name') ?? p });
      }
    }
    if (out.length > 0) return out;
  }

  return Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((path) => ({ path, name: path.replace(/^.*\//, '').replace(/\.xml$/, '') }));
}

function textCells(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(MAIN_NS, 'c')).filter((c) => {
    const t = c.getAttribute('t');
    return t === 's' || t === 'inlineStr';
  });
}

function cellText(c: Element, shared: string[]): string {
  if (c.getAttribute('t') === 's') {
    const v = c.getElementsByTagNameNS(MAIN_NS, 'v')[0];
    const idx = Number(v?.textContent ?? '');
    return Number.isInteger(idx) ? (shared[idx] ?? '') : '';
  }
  const is = c.getElementsByTagNameNS(MAIN_NS, 'is')[0];
  return is ? textOf(is) : '';
}

function rowOf(c: Element): string {
  return (c.getAttribute('r') ?? '').replace(/[A-Z]+/i, '');
}

export async function parseXlsx(file: File): Promise<LoadedDocument> {
  const zip = await JSZip.loadAsync(await readBlobBytes(file));
  const paths = await sheetPaths(zip);
  if (paths.length === 0) {
    throw new Error('Invalid Excel (.xlsx) file.');
  }
  const shared = await loadSharedStrings(zip);

  const sheets: SheetInfo[] = [];
  const segments: Segment[] = [];
  const cells: CellRef[] = [];
  const layoutSheets: { name: string; cells: XlsxCellLayout[] }[] = [];
  let text = '';

  for (const [sheetIdx, { path, name }] of paths.entries()) {
    const doc = parseXml(await zip.file(path)!.async('string'), path);
    sheets.push({ path, doc });
    const layoutCells: XlsxCellLayout[] = [];
    let lastRow = '';

    textCells(doc).forEach((c, cellIdx) => {
      const t = cellText(c, shared);
      if (t.length === 0) return;
      const row = rowOf(c);
      if (text.length > 0 && !text.endsWith('\n')) {
        text += row === lastRow ? '\t' : '\n';
      }
      lastRow = row;
      const coords = cellCoords(c.getAttribute('r') ?? '');
      segments.push({ start: text.length, end: text.length + t.length, text: t });
      layoutCells.push({ start: text.length, end: text.length + t.length, ...coords });
      cells.push({ sheetIdx, cellIdx });
      text += t;
    });

    layoutSheets.push({ name, cells: layoutCells });
    if (!text.endsWith('\n')) text += '\n';
    text += '\n';
  }

  const sharedStringsXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? null;
  const handle: XlsxHandle = { zip, sheets, sharedStringsXml, segments, cells };
  return {
    fileName: file.name,
    format: 'xlsx',
    text,
    handle,
    layout: { kind: 'xlsx', sheets: layoutSheets },
  };
}

function setInlineString(c: Element, value: string): void {
  const doc = c.ownerDocument;
  for (const child of Array.from(c.children)) {
    if (isMain(child, 'v') || isMain(child, 'is') || isMain(child, 'f')) {
      c.removeChild(child);
    }
  }
  c.setAttribute('t', 'inlineStr');
  const is = doc.createElementNS(MAIN_NS, 'is');
  const t = doc.createElementNS(MAIN_NS, 't');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.textContent = value;
  is.append(t);
  c.append(is);
}

function serializeXml(doc: Document): string {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith('<?xml')
    ? xml
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

function scrubSharedStrings(xml: string, referenced: Set<number>): string {
  const doc = parseXml(xml, 'xl/sharedStrings.xml');
  Array.from(doc.documentElement.children)
    .filter((si) => isMain(si, 'si'))
    .forEach((si, idx) => {
      if (referenced.has(idx)) return;
      while (si.firstChild) si.removeChild(si.firstChild);
      const t = doc.createElementNS(MAIN_NS, 't');
      si.append(t);
    });
  return serializeXml(doc);
}

/**
 * Rewrites edited cells as inline strings while preserving cell styles (`s`),
 * and clears unreferenced `sharedStrings.xml` entries so zero PII lingers.
 */
export async function generateXlsx(doc: LoadedDocument, edits: TextEdit[]): Promise<Blob> {
  const handle = doc.handle as XlsxHandle;
  const changes = distributeEdits(handle.segments, edits);

  const perSheet = new Map<number, Map<number, string>>();
  for (const [segIdx, newText] of changes) {
    const ref = handle.cells[segIdx];
    if (!perSheet.has(ref.sheetIdx)) perSheet.set(ref.sheetIdx, new Map());
    perSheet.get(ref.sheetIdx)!.set(ref.cellIdx, newText);
  }

  const referenced = new Set<number>();
  for (const [sheetIdx, sheet] of handle.sheets.entries()) {
    const clone = sheet.doc.cloneNode(true) as Document;
    const cellChanges = perSheet.get(sheetIdx);
    if (cellChanges) {
      const cells = textCells(clone);
      for (const [cellIdx, value] of cellChanges) {
        setInlineString(cells[cellIdx], value);
      }
    }
    for (const c of Array.from(clone.getElementsByTagNameNS(MAIN_NS, 'c'))) {
      if (c.getAttribute('t') !== 's') continue;
      const idx = Number(c.getElementsByTagNameNS(MAIN_NS, 'v')[0]?.textContent ?? '');
      if (Number.isInteger(idx)) referenced.add(idx);
    }
    handle.zip.file(sheet.path, serializeXml(clone));
  }

  if (handle.sharedStringsXml !== null) {
    handle.zip.file(
      'xl/sharedStrings.xml',
      scrubSharedStrings(handle.sharedStringsXml, referenced),
    );
  }

  return handle.zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
}
