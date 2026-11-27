import {
  MAX_FILE_BYTES,
  type DocFormat,
  type LoadedDocument,
  type TextEdit,
} from '../core/types';
import type { ParsePdfOptions } from './pdf';
import { generatePlainText, parsePlainText } from './plaintext';

export const SUPPORTED_EXTENSIONS: Record<string, DocFormat> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  csv: 'csv',
  docx: 'docx',
  xlsx: 'xlsx',
  pdf: 'pdf',
};

export const ACCEPT_ATTR = '.txt,.md,.markdown,.csv,.docx,.xlsx,.pdf';

export function detectFormat(fileName: string): DocFormat | null {
  const ext = fileName.trim().split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS[ext] ?? null;
}

export function validateFile(file: { name: string; size: number }): DocFormat {
  const format = detectFormat(file.name);
  if (!format) {
    throw new Error(
      'Unsupported file format. Please upload PDF, Word (.docx), Excel (.xlsx), CSV, TXT, or Markdown.',
    );
  }
  if (file.size <= 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB size limit.`);
  }
  return format;
}

export async function parseDocument(
  file: File,
  opts: ParsePdfOptions = {},
): Promise<LoadedDocument> {
  const format = validateFile(file);
  switch (format) {
    case 'txt':
    case 'md':
    case 'csv':
      return parsePlainText(file, format);
    case 'docx':
      return (await import('./docx')).parseDocx(file);
    case 'xlsx':
      return (await import('./xlsx')).parseXlsx(file);
    case 'pdf':
      return (await import('./pdf')).parsePdf(file, opts);
  }
}

export async function generateDocument(doc: LoadedDocument, edits: TextEdit[]): Promise<Blob> {
  switch (doc.format) {
    case 'txt':
    case 'md':
    case 'csv':
      return generatePlainText(doc, edits);
    case 'docx':
      return (await import('./docx')).generateDocx(doc, edits);
    case 'xlsx':
      return (await import('./xlsx')).generateXlsx(doc, edits);
    case 'pdf':
      return (await import('./pdf')).generatePdf(doc, edits);
  }
}

export const loadDocument = parseDocument;
export const applyDocumentEdits = generateDocument;
export const restoreDocument = generateDocument;

export function outputFileName(original: string, suffix = 'sanitized'): string {
  const leaf = original.trim().split(/[\\/]/).pop() ?? 'document';
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0) return `${leaf}.${suffix}`;
  return `${leaf.slice(0, dot)}.${suffix}${leaf.slice(dot)}`;
}

export function mappingFileName(original: string): string {
  const leaf = original.trim().split(/[\\/]/).pop() ?? 'document';
  const dot = leaf.lastIndexOf('.');
  const base = dot <= 0 ? leaf : leaf.slice(0, dot);
  return `${base}.mapping.csv`;
}

export function formatLimitations(format: DocFormat, ocr = false): string | null {
  if (format === 'pdf' && ocr) {
    return 'Scanned PDF processed locally via client-side English OCR. Rebuilt output draws recognized text at original coordinates plus non-text pictures; inspect the preview before downloading.';
  }
  if (format === 'pdf') {
    return 'PDF output rebuilds text at original coordinates without copying original text objects or embedded fonts, ensuring zero raw PII survives underneath.';
  }
  if (format === 'xlsx') {
    return 'Excel output preserves styles and workbook structure while scrubbing orphaned shared strings; only text-typed cells are redacted.';
  }
  if (format === 'docx') {
    return 'Word output preserves paragraph styles, tables, headers, and footers; inspect special floating textboxes in the preview.';
  }
  return null;
}
