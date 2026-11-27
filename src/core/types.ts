/** Supported PII entity categories detected and sanitized by the engine. */
export type PiiType =
  | 'EMAIL'
  | 'PHONE'
  | 'IP'
  | 'PAN'
  | 'AADHAAR'
  | 'CREDIT_CARD';

/** Supported redaction transformation modes. */
export type RedactionMode = 'full' | 'partial' | 'pseudonym';

/** A validated, non-overlapping PII match located in the source text. */
export interface PiiMatch {
  id: string;
  type: PiiType;
  value: string;
  normalized: string;
  start: number;
  end: number;
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
