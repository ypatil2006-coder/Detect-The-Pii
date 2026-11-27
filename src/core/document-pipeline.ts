/**
 * @module document-pipeline
 * @description Orchestrates multi-format document analysis and redaction.
 *
 * Accepts a {@link LoadedDocument} (parsed by `src/formats/`) and runs the full
 * detect → validate → redact → diff → export pipeline, returning a
 * {@link DocumentSessionResult} ready for the UI diff viewer and audit panel.
 *
 * All operations are synchronous and browser-local — no network calls are made.
 */
import { serializeMapping } from '../formats/csv';
import {
  generateDocument,
  mappingFileName as buildMappingFileName,
  outputFileName,
} from '../formats/index';
import { CodeBook } from './codes';
import { detectPii, detectWithTimings, type DetectTimings } from './detector';
import { maskDisplay } from './mask';
import type { PipelineStageTiming } from './pipeline';
export type { PipelineStageTiming } from './pipeline';
import { applyEdits, blankOut, splitItem } from './redactor';
import {
  createEmptyStats,
  createPseudonymState,
  type DetectionStats,
  type DiffRow,
  type DiffSegment,
  type ExtendedCategory,
  type LoadedDocument,
  type MappingEntry,
  type MarkerStyle,
  type Pattern,
  type PiiType,
  type PseudonymMapEntry,
  type PseudonymState,
  type RedactionItem,
  type TextEdit,
} from './types';
import { normalizeEntityValue } from './validators';

/** Full interactive session output for any loaded document format. */
export interface DocumentSessionResult {
  doc: LoadedDocument;
  items: RedactionItem[];
  mappings: MappingEntry[];
  sanitizedText: string;
  diffRows: DiffRow[];
  stats: DetectionStats;
  pseudonyms: PseudonymMapEntry[];
  stages: PipelineStageTiming[];
  durationMs: number;
}

const CORE_TYPES = new Set<PiiType>([
  'EMAIL',
  'PHONE',
  'IP',
  'PAN',
  'AADHAAR',
  'CREDIT_CARD',
]);

const PSEUDONYM_PREFIX: Record<ExtendedCategory, string> = {
  EMAIL: 'USER',
  PHONE: 'PHONE',
  IP: 'IP',
  PAN: 'PAN',
  AADHAAR: 'AADHAAR',
  CREDIT_CARD: 'CARD',
  SSN: 'SSN',
  IBAN: 'IBAN',
  DOB: 'DOB',
  CUSTOM: 'CUSTOM',
};

const extendedCountersByState = new WeakMap<PseudonymState, Record<string, number>>();

function isCorePiiType(category: ExtendedCategory): category is PiiType {
  return CORE_TYPES.has(category as PiiType);
}

function normalizeForCategory(category: ExtendedCategory, raw: string): string {
  if (isCorePiiType(category)) {
    return normalizeEntityValue(category, raw);
  }
  return raw.trim();
}

function getExtendedCounterMap(state: PseudonymState): Record<string, number> {
  let map = extendedCountersByState.get(state);
  if (!map) {
    map = { SSN: 0, IBAN: 0, DOB: 0, CUSTOM: 0 };
    extendedCountersByState.set(state, map);
  }
  return map;
}

function nextPseudonymForItem(
  category: ExtendedCategory,
  original: string,
  state: PseudonymState,
): string {
  const normalized = normalizeForCategory(category, original);
  const key = `${category}:${normalized}`;
  const existing = state.map.get(key);
  if (existing) {
    return existing;
  }

  let nextNum: number;
  if (isCorePiiType(category)) {
    state.counters[category] += 1;
    nextNum = state.counters[category];
  } else {
    const ext = getExtendedCounterMap(state);
    ext[category] = (ext[category] ?? 0) + 1;
    nextNum = ext[category];
  }

  const placeholder = `${PSEUDONYM_PREFIX[category]}_${String(nextNum).padStart(2, '0')}`;
  state.map.set(key, placeholder);
  return placeholder;
}

function seedPseudonymState(
  state: PseudonymState,
  existingMappings?: MappingEntry[],
): void {
  if (!existingMappings || existingMappings.length === 0) {
    return;
  }
  for (const entry of existingMappings) {
    const full = `${entry.prefix ?? ''}${entry.original}${entry.suffix ?? ''}`;
    const cat = (entry.category || 'CUSTOM') as ExtendedCategory;
    const key = `${cat}:${normalizeForCategory(cat, full)}`;
    if (!state.map.has(key)) {
      state.map.set(key, entry.code);
    }
    const suffixMatch = entry.code.match(/_(\d+)$/);
    if (suffixMatch) {
      const n = Number(suffixMatch[1]);
      if (isCorePiiType(cat)) {
        state.counters[cat] = Math.max(state.counters[cat], n);
      } else {
        const ext = getExtendedCounterMap(state);
        ext[cat] = Math.max(ext[cat] ?? 0, n);
      }
    }
  }
}

function computeReplacement(
  item: RedactionItem,
  markerStyle: MarkerStyle,
  pseudonymCode: string,
): string {
  if (markerStyle === 'full') {
    return '[REDACTED]';
  }
  if (markerStyle === 'partial') {
    if (item.retention && item.retention.mode !== 'none' && item.retention.mode !== 'preview') {
      const { prefix, hidden, suffix } = splitItem(item);
      return prefix + '*'.repeat(Math.max(1, hidden.length)) + suffix;
    }
    return maskDisplay(item.category, item.original);
  }
  if (markerStyle === 'pseudonym') {
    const { prefix, suffix } = splitItem(item);
    return prefix + pseudonymCode + suffix;
  }
  if (markerStyle === 'category') {
    const { prefix, suffix } = splitItem(item);
    return prefix + `[${item.category}]` + suffix;
  }
  const { prefix, hidden, suffix } = splitItem(item);
  return prefix + blankOut(hidden) + suffix;
}

function buildDiffRowsForItems(
  original: string,
  activeItems: RedactionItem[],
  replacements: string[],
  markerStyle: MarkerStyle,
  stripBomFromFirstLine: boolean,
): DiffRow[] {
  const rawLines = original.split('\n');
  const rows: DiffRow[] = [];
  let lineStart = 0;
  let itemIdx = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const hasCr = rawLine.endsWith('\r');
    const visibleLength = hasCr ? rawLine.length - 1 : rawLine.length;
    const lineEnd = lineStart + visibleLength;
    const displayStart =
      stripBomFromFirstLine && i === 0 && rawLine.charCodeAt(0) === 0xfeff
        ? lineStart + 1
        : lineStart;

    while (itemIdx < activeItems.length && activeItems[itemIdx].end <= displayStart) {
      itemIdx++;
    }

    const originalSegments: DiffSegment[] = [];
    const sanitizedSegments: DiffSegment[] = [];
    let cursor = displayStart;
    let hasChanges = false;

    let j = itemIdx;
    while (j < activeItems.length && activeItems[j].start < lineEnd) {
      const item = activeItems[j];
      const spanStart = Math.max(item.start, displayStart);
      const spanEnd = Math.min(item.end, lineEnd);

      if (spanStart > cursor) {
        const plain = original.slice(cursor, spanStart);
        originalSegments.push({ text: plain, kind: 'plain' });
        sanitizedSegments.push({ text: plain, kind: 'plain' });
      }

      const rawValue = original.slice(spanStart, spanEnd);
      const repl = replacements[j] ?? '[REDACTED]';
      const piiType = isCorePiiType(item.category) ? item.category : undefined;

      originalSegments.push({
        text: rawValue,
        kind: 'pii',
        ...(piiType ? { type: piiType } : {}),
      });

      const redSeg: DiffSegment = {
        text: repl,
        kind: 'redacted',
        ...(piiType ? { type: piiType } : {}),
        ...(markerStyle === 'pseudonym'
          ? { placeholder: repl }
          : markerStyle === 'category'
            ? { placeholder: `[${item.category}]` }
            : {}),
      };
      sanitizedSegments.push(redSeg);

      hasChanges = true;
      cursor = spanEnd;
      j++;
    }

    if (cursor < lineEnd) {
      const trailing = original.slice(cursor, lineEnd);
      originalSegments.push({ text: trailing, kind: 'plain' });
      sanitizedSegments.push({ text: trailing, kind: 'plain' });
    }

    rows.push({
      lineNumber: i + 1,
      hasChanges,
      originalSegments,
      sanitizedSegments,
    });

    itemIdx = j;
    lineStart += rawLine.length + 1;
  }

  return rows;
}

function roundMs(ms: number): number {
  return Number(Math.max(0, ms).toFixed(3));
}

function buildSessionFromItems(
  doc: LoadedDocument,
  items: RedactionItem[],
  markerStyle: MarkerStyle,
  state: PseudonymState,
  parseMs: number,
  timings: DetectTimings,
  totalStart: number,
): DocumentSessionResult {
  const redactStart = performance.now();
  const activeSorted = items
    .filter((it) => it.active)
    .sort((a, b) => a.start - b.start);

  const stats = createEmptyStats();
  const basePii = detectPii(doc.text).stats;
  stats.rejectedCreditCards = basePii.rejectedCreditCards;
  stats.rejectedAadhaar = basePii.rejectedAadhaar;

  const edits: TextEdit[] = [];
  const replacements: string[] = [];
  const mappings: MappingEntry[] = [];
  const seenCodes = new Set<string>();
  const pseudonymMap = new Map<string, PseudonymMapEntry>();

  for (const item of activeSorted) {
    stats.total += 1;
    if (isCorePiiType(item.category)) {
      stats.byType[item.category] += 1;
    }

    const code =
      markerStyle === 'pseudonym'
        ? nextPseudonymForItem(item.category, item.original, state)
        : item.code;
    if (markerStyle === 'pseudonym') {
      item.code = code;
    }

    const replacement = computeReplacement(item, markerStyle, code);
    replacements.push(replacement);
    edits.push({ start: item.start, end: item.end, replacement });

    if (markerStyle === 'pseudonym') {
      if (!seenCodes.has(code)) {
        seenCodes.add(code);
        const { prefix, hidden, suffix } = splitItem(item);
        const entry: MappingEntry = {
          code,
          category: item.category,
          original: hidden,
        };
        if (prefix) {
          entry.prefix = prefix;
        }
        if (suffix) {
          entry.suffix = suffix;
        }
        mappings.push(entry);
      }

      if (isCorePiiType(item.category)) {
        const existingPseudo = pseudonymMap.get(code);
        if (existingPseudo) {
          existingPseudo.count += 1;
        } else {
          pseudonymMap.set(code, {
            placeholder: code,
            type: item.category,
            maskedPreview: maskDisplay(item.category, item.original),
            count: 1,
          });
        }
      }
    }
  }

  const sanitizedText = applyEdits(doc.text, edits);
  const redactMs = performance.now() - redactStart;

  const diffStart = performance.now();
  const diffRows = buildDiffRowsForItems(
    doc.text,
    activeSorted,
    replacements,
    markerStyle,
    doc.format === 'csv',
  );
  const diffMs = performance.now() - diffStart;

  const otherMatched =
    stats.byType.EMAIL + stats.byType.PHONE + stats.byType.IP + stats.byType.PAN;
  const changedLines = diffRows.filter((r) => r.hasChanges).length;

  const stages: PipelineStageTiming[] = [
    {
      id: 'parse',
      label: 'Input Parse',
      durationMs: roundMs(parseMs),
      matchedCount: doc.text ? doc.text.split('\n').length : 0,
    },
    {
      id: 'scan',
      label: 'Pattern Scan',
      durationMs: roundMs(timings.scanMs),
      matchedCount: stats.total,
    },
    {
      id: 'luhn',
      label: 'Luhn Card Check',
      durationMs: roundMs(timings.luhnMs),
      matchedCount: stats.byType.CREDIT_CARD,
      rejectedCount: stats.rejectedCreditCards,
    },
    {
      id: 'verhoeff',
      label: 'Verhoeff Aadhaar Check',
      durationMs: roundMs(timings.verhoeffMs),
      matchedCount: stats.byType.AADHAAR,
      rejectedCount: stats.rejectedAadhaar,
    },
    {
      id: 'validators',
      label: 'PAN / IP / Email / Phone',
      durationMs: roundMs(timings.validatorsMs),
      matchedCount: otherMatched,
    },
    {
      id: 'redact',
      label: 'Mode Operator',
      durationMs: roundMs(redactMs),
      matchedCount: stats.total,
    },
    {
      id: 'diff',
      label: 'Diff & Export',
      durationMs: roundMs(diffMs),
      matchedCount: changedLines,
    },
  ];

  return {
    doc,
    items,
    mappings,
    sanitizedText,
    diffRows,
    stats,
    pseudonyms: Array.from(pseudonymMap.values()),
    stages,
    durationMs: performance.now() - totalStart,
  };
}

/**
 * Analyzes a loaded document of any format (`.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`)
 * against active patterns and applies the selected `MarkerStyle`.
 */
export function analyzeDocument(
  doc: LoadedDocument,
  patterns: Pattern[],
  markerStyle: MarkerStyle,
  sharedState?: PseudonymState,
  existingMappings?: MappingEntry[],
): DocumentSessionResult {
  const totalStart = performance.now();
  const parseStart = performance.now();
  const state = sharedState ?? createPseudonymState();
  seedPseudonymState(state, existingMappings);

  const book = new CodeBook();
  if (existingMappings && existingMappings.length > 0) {
    book.seed(existingMappings);
  }
  const parseMs = performance.now() - parseStart;

  const { items, timings } = detectWithTimings(doc.text, patterns, book);

  return buildSessionFromItems(doc, items, markerStyle, state, parseMs, timings, totalStart);
}

/**
 * Recomputes sanitized text, diff rows, stats, and mappings after interactive
 * item toggling, category toggling, or manual item additions.
 */
export function recomputeDocumentSession(
  doc: LoadedDocument,
  items: RedactionItem[],
  markerStyle: MarkerStyle,
  sharedState?: PseudonymState,
): DocumentSessionResult {
  const totalStart = performance.now();
  const state = sharedState ?? createPseudonymState();
  const zeroTimings: DetectTimings = {
    scanMs: 0,
    luhnMs: 0,
    verhoeffMs: 0,
    validatorsMs: 0,
  };
  return buildSessionFromItems(doc, items, markerStyle, state, 0, zeroTimings, totalStart);
}

/**
 * Generates the downloadable sanitized file Blob (in the source document's original
 * format: TXT, MD, CSV, DOCX, XLSX, or PDF) and optional reversible `.mapping.csv`.
 */
export async function buildExportBlob(
  session: DocumentSessionResult,
  markerStyle: MarkerStyle,
): Promise<{
  sanitizedBlob: Blob;
  fileName: string;
  mappingCsv: string;
  mappingFileName: string;
}> {
  const activeSorted = session.items
    .filter((it) => it.active)
    .sort((a, b) => a.start - b.start);
  const state = createPseudonymState();
  seedPseudonymState(state, session.mappings);

  const edits: TextEdit[] = activeSorted.map((item) => {
    const code =
      markerStyle === 'pseudonym'
        ? nextPseudonymForItem(item.category, item.original, state)
        : item.code;
    return {
      start: item.start,
      end: item.end,
      replacement: computeReplacement(item, markerStyle, code),
    };
  });

  const sanitizedBlob = await generateDocument(session.doc, edits);
  const fileName = outputFileName(session.doc.fileName, `sanitized-${markerStyle}`);
  const mappingCsv =
    markerStyle === 'pseudonym' ? serializeMapping(session.mappings) : '';
  const mappingFileName = buildMappingFileName(session.doc.fileName);

  return {
    sanitizedBlob,
    fileName,
    mappingCsv,
    mappingFileName,
  };
}
