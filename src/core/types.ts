/** Supported core PII entity categories detected and sanitized by the engine. */
export type PiiType =
  | 'EMAIL'
  | 'PHONE'
  | 'IP'
  | 'PAN'
  | 'AADHAAR'
  | 'CREDIT_CARD';

/** Extended category list covering core PII plus international & custom rules. */
export const EXTENDED_CATEGORIES = [
  'EMAIL',
  'PHONE',
  'IP',
  'PAN',
  'AADHAAR',
  'CREDIT_CARD',
  'SSN',
  'IBAN',
  'DOB',
  'CUSTOM',
] as const;

/** Extended category union used across multi-format document redaction and rules UI. */
export type ExtendedCategory = (typeof EXTENDED_CATEGORIES)[number];

/** Alias for `ExtendedCategory` matching multi-format document engines. */
export type Category = ExtendedCategory;

/** Supported input/output document formats. */
export type DocFormat = 'txt' | 'md' | 'csv' | 'docx' | 'xlsx' | 'pdf';

/** Supported redaction transformation modes. */
export type RedactionMode = 'full' | 'partial' | 'pseudonym';

/** Marker formatting styles across text and rich document exports. */
export type MarkerStyle = 'full' | 'partial' | 'pseudonym' | 'category' | 'blank';

/** How much of a detected value stays visible outside the redaction marker. */
export type Retention =
  | { mode: 'none' }
  | { mode: 'ends'; head: number; tail: number }
  | { mode: 'delim'; delimiter: string; side: 'before' | 'after' }
  | { mode: 'preview' };

/** Detection rule definition for built-in or user-defined RegExp rules. */
export interface Pattern {
  id: string;
  name: string;
  category: ExtendedCategory;
  source: 'builtin' | 'custom';
  regex: string;
  example: string;
  enabled: boolean;
  retention?: Retention;
  group?: 'in' | 'intl';
  note?: string;
  /** Second-pass filter (e.g. checksum/libphonenumber); returns false or accepted prefix length. */
  validate?: (match: string, before: string) => boolean | number;
}

/** A validated, non-overlapping PII match located in the source text. */
export interface PiiMatch {
  id: string;
  type: PiiType;
  value: string;
  normalized: string;
  start: number;
  end: number;
}

/** Multi-format document redaction item supporting toggling, manual selection, and retention. */
export interface RedactionItem {
  id: string;
  category: ExtendedCategory;
  original: string;
  start: number;
  end: number;
  code: string;
  origin: 'auto' | 'manual';
  active: boolean;
  retention?: Retention;
  head?: number;
  tail?: number;
}

/** Reversible mapping table row pairing a placeholder/code to its original value. */
export interface MappingEntry {
  code: string;
  category: string;
  original: string;
  prefix?: string;
  suffix?: string;
}

/** A single replacement in a document's full text, expressed in UTF-16 text offsets. */
export interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

/** Aggregate detection and false-positive rejection counts for a document. */
export interface DetectionStats {
  total: number;
  byType: Record<PiiType, number>;
  rejectedCreditCards: number;
  rejectedAadhaar: number;
}

/** Audit entry for a deterministic pseudonym placeholder mapping. */
export interface PseudonymMapEntry {
  placeholder: string;
  type: PiiType;
  maskedPreview: string;
  count: number;
}

/** Complete output produced by running sanitization on a text payload. */
export interface SanitizeResult {
  original: string;
  sanitized: string;
  mode: RedactionMode;
  matches: PiiMatch[];
  stats: DetectionStats;
  pseudonyms: PseudonymMapEntry[];
  durationMs: number;
}

/** Single styled text run within a side-by-side diff line. */
export interface DiffSegment {
  text: string;
  kind: 'plain' | 'pii' | 'redacted';
  type?: PiiType;
  placeholder?: string;
}

/** Synchronized line pair for Original vs. Sanitized side-by-side diff views. */
export interface DiffRow {
  lineNumber: number;
  hasChanges: boolean;
  originalSegments: DiffSegment[];
  sanitizedSegments: DiffSegment[];
}

/** Mutable per-document or cross-row state for consistent pseudonymization. */
export interface PseudonymState {
  map: Map<string, string>;
  counters: Record<PiiType, number>;
}

/** Signature of the core sanitization function injected into format handlers. */
export type SanitizeFn = (
  text: string,
  mode: RedactionMode,
  sharedState?: PseudonymState,
) => SanitizeResult;

/** Paragraph offset map for format-aware DOCX previews. */
export interface DocxParagraphLayout {
  start: number;
  end: number;
  style: 'title' | 'heading' | 'normal';
  part: 'body' | 'header' | 'footer';
  table?: { id: number; row: number; col: number };
}

/** Cell offset map for format-aware XLSX previews. */
export interface XlsxCellLayout {
  start: number;
  end: number;
  row: number;
  col: number;
}

/** 0–255 RGB tuple. */
export type Rgb = [number, number, number];

/** Positioned text run on a PDF page. */
export interface PdfItemLayout {
  start: number;
  end: number;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  color?: Rgb;
}

/** Text-free raster picture cut from a scanned PDF page. */
export interface PdfPicture {
  x: number;
  y: number;
  width: number;
  height: number;
  jpeg: Uint8Array;
  keep: boolean;
}

/** Vector line redrawn on a scanned PDF page. */
export interface PdfRule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: Rgb;
  dashed?: boolean;
}

/** Vector fill rectangle redrawn on a scanned PDF page. */
export interface PdfFill {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Rgb;
}

/** Vector checkbox redrawn on a scanned PDF page. */
export interface PdfCheckbox {
  x: number;
  y: number;
  size: number;
  checked: boolean;
  color: Rgb;
}

/** Optional vector/picture structure extracted from a scanned PDF page. */
export interface PdfScanLayout {
  pictures?: PdfPicture[];
  rules?: PdfRule[];
  fills?: PdfFill[];
  checkboxes?: PdfCheckbox[];
}

/** Format-specific layout metadata for rich previews. */
export type DocLayout =
  | { kind: 'docx'; paragraphs: DocxParagraphLayout[] }
  | { kind: 'xlsx'; sheets: { name: string; cells: XlsxCellLayout[] }[] }
  | {
      kind: 'pdf';
      pages: ({ width: number; height: number; items: PdfItemLayout[] } & PdfScanLayout)[];
    };

/** Loaded multi-format document handle ready for detection and export. */
export interface LoadedDocument {
  fileName: string;
  format: DocFormat;
  text: string;
  handle: unknown;
  layout?: DocLayout;
  ocr?: boolean;
}

/** Serializable custom RegExp rule stored in browser localStorage. */
export interface CustomPatternConfig {
  id: string;
  name: string;
  category: ExtendedCategory;
  regex: string;
  example: string;
  enabled: boolean;
}

/** Persisted user pattern & retention preferences. */
export interface PatternConfig {
  version: 1;
  disabledBuiltins: string[];
  customPatterns: CustomPatternConfig[];
  retention?: Record<string, Retention>;
}

/** Maximum client-side upload size (100 MB). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

function createZeroTypeCounts(): Record<PiiType, number> {
  return {
    EMAIL: 0,
    PHONE: 0,
    IP: 0,
    PAN: 0,
    AADHAAR: 0,
    CREDIT_CARD: 0,
  };
}

/** Creates a zero-initialized detection statistics object. */
export function createEmptyStats(): DetectionStats {
  return {
    total: 0,
    byType: createZeroTypeCounts(),
    rejectedCreditCards: 0,
    rejectedAadhaar: 0,
  };
}

/** Creates a fresh pseudonym mapping state with zeroed per-type counters. */
export function createPseudonymState(): PseudonymState {
  return {
    map: new Map<string, string>(),
    counters: createZeroTypeCounts(),
  };
}
