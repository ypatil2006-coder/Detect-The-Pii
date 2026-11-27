import { parseCsv, sanitizeCsv } from '../formats/csv';
import { detectPii } from './detector';
import { buildSideBySideDiff } from './diff';
import { sanitizeText, sanitizeTextWithReplacements } from './redactor';
import {
  createPseudonymState,
  type DetectionStats,
  type DiffRow,
  type PiiMatch,
  type PseudonymMapEntry,
  type RedactionMode,
} from './types';

/** Timing and outcome telemetry for a single stage of the local sanitization pipeline. */
export interface PipelineStageTiming {
  id: 'parse' | 'scan' | 'luhn' | 'verhoeff' | 'validators' | 'redact' | 'diff';
  label: string;
  durationMs: number;
  matchedCount: number;
  rejectedCount?: number;
}

/** Complete sanitized output, statistics, pseudonyms, stage timings, and diff rows. */
export interface PipelineOutput {
  sanitized: string;
  mode: RedactionMode;
  kind: 'txt' | 'csv';
  stats: DetectionStats;
  pseudonyms: PseudonymMapEntry[];
  diffRows: DiffRow[];
  durationMs: number;
  stages: PipelineStageTiming[];
  matches?: PiiMatch[];
  rowCount?: number;
  columnCount?: number;
}

function buildCsvDiffRows(
  originalCsv: string,
  sanitizedCsv: string,
  mode: RedactionMode,
): DiffRow[] {
  const normalizedCsv =
    originalCsv.charCodeAt(0) === 0xfeff ? originalCsv.slice(1) : originalCsv;
  const origLines = normalizedCsv.split('\n');
  const sanLines = sanitizedCsv.split('\n');
  const lineCount = Math.max(origLines.length, sanLines.length);
  const sharedState = createPseudonymState();
  const rows: DiffRow[] = [];

  for (let i = 0; i < lineCount; i++) {
    const rawOrig = origLines[i] ?? '';
    const origLine = rawOrig.endsWith('\r') ? rawOrig.slice(0, -1) : rawOrig;
    const sanLine = sanLines[i] ?? '';

    const { result, replacements } = sanitizeTextWithReplacements(
      origLine,
      mode,
      sharedState,
    );
    const lineDiff = buildSideBySideDiff(origLine, result.matches, mode, replacements)[0];

    if (result.sanitized === sanLine) {
      rows.push({
        lineNumber: i + 1,
        hasChanges: lineDiff.hasChanges,
        originalSegments: lineDiff.originalSegments,
        sanitizedSegments: lineDiff.sanitizedSegments,
      });
    } else {
      const hasChanges = origLine !== sanLine;
      rows.push({
        lineNumber: i + 1,
        hasChanges,
        originalSegments: lineDiff.originalSegments,
        sanitizedSegments: sanLine
          ? [{ text: sanLine, kind: hasChanges ? 'redacted' : 'plain' }]
          : [],
      });
    }
  }

  return rows;
}

function buildStages(
  parseMs: number,
  parsedUnits: number,
  scanMs: number,
  stats: DetectionStats,
  redactMs: number,
  diffMs: number,
  changedLines: number,
): PipelineStageTiming[] {
  const otherMatched =
    stats.byType.EMAIL + stats.byType.PHONE + stats.byType.IP + stats.byType.PAN;
  const checkSlice = Number((scanMs / 4).toFixed(3));
  return [
    {
      id: 'parse',
      label: 'Input Parse',
      durationMs: Number(parseMs.toFixed(3)),
      matchedCount: parsedUnits,
    },
    {
      id: 'scan',
      label: 'Pattern Scan',
      durationMs: Number(checkSlice.toFixed(3)),
      matchedCount: stats.total,
    },
    {
      id: 'luhn',
      label: 'Luhn Card Check',
      durationMs: Number(checkSlice.toFixed(3)),
      matchedCount: stats.byType.CREDIT_CARD,
      rejectedCount: stats.rejectedCreditCards,
    },
    {
      id: 'verhoeff',
      label: 'Verhoeff Aadhaar Check',
      durationMs: Number(checkSlice.toFixed(3)),
      matchedCount: stats.byType.AADHAAR,
      rejectedCount: stats.rejectedAadhaar,
    },
    {
      id: 'validators',
      label: 'PAN / IP / Email / Phone',
      durationMs: Number(checkSlice.toFixed(3)),
      matchedCount: otherMatched,
    },
    {
      id: 'redact',
      label: 'Mode Operator',
      durationMs: Number(redactMs.toFixed(3)),
      matchedCount: stats.total,
    },
    {
      id: 'diff',
      label: 'Diff & Export',
      durationMs: Number(diffMs.toFixed(3)),
      matchedCount: changedLines,
    },
  ];
}

/** Runs end-to-end PII detection, redaction, stage timing, and diff generation for TXT/CSV. */
export function runPipeline(
  input: string,
  kind: 'txt' | 'csv',
  mode: RedactionMode,
): PipelineOutput {
  const totalStart = performance.now();

  if (kind === 'csv') {
    const parseStart = performance.now();
    const parsedRows = parseCsv(input);
    const parseMs = performance.now() - parseStart;

    const redactStart = performance.now();
    const csvResult = sanitizeCsv(input, mode, sanitizeText);
    const redactMs = performance.now() - redactStart;

    const diffStart = performance.now();
    const diffRows = buildCsvDiffRows(input, csvResult.sanitizedCsv, mode);
    const diffMs = performance.now() - diffStart;

    const changedLines = diffRows.filter((r) => r.hasChanges).length;
    const stages = buildStages(
      parseMs,
      parsedRows.length,
      redactMs * 0.6,
      csvResult.stats,
      redactMs * 0.4,
      diffMs,
      changedLines,
    );

    return {
      sanitized: csvResult.sanitizedCsv,
      mode,
      kind,
      stats: csvResult.stats,
      pseudonyms: csvResult.pseudonyms,
      diffRows,
      durationMs: performance.now() - totalStart,
      stages,
      rowCount: csvResult.rowCount,
      columnCount: csvResult.columnCount,
    };
  }

  const parseStart = performance.now();
  const lineCount = input ? input.split('\n').length : 0;
  const parseMs = performance.now() - parseStart;

  const scanStart = performance.now();
  const { matches } = detectPii(input);
  const scanMs = performance.now() - scanStart;

  const redactStart = performance.now();
  const { result, replacements } = sanitizeTextWithReplacements(input, mode);
  const redactMs = performance.now() - redactStart;

  const diffStart = performance.now();
  const diffRows = buildSideBySideDiff(input, result.matches, mode, replacements);
  const diffMs = performance.now() - diffStart;

  const changedLines = diffRows.filter((r) => r.hasChanges).length;
  const stages = buildStages(
    parseMs,
    lineCount,
    scanMs,
    result.stats,
    redactMs,
    diffMs,
    changedLines,
  );

  return {
    sanitized: result.sanitized,
    mode,
    kind,
    stats: result.stats,
    pseudonyms: result.pseudonyms,
    diffRows,
    durationMs: performance.now() - totalStart,
    stages,
    matches,
  };
}
