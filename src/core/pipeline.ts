import { parseCsv, sanitizeCsv } from '../formats/csv';
import { type DetectTimings } from './detector';
import { buildSideBySideDiff } from './diff';
import { sanitizeTextWithReplacements } from './redactor';
import {
  createPseudonymState,
  type DetectionStats,
  type DiffRow,
  type PiiMatch,
  type PseudonymMapEntry,
  type RedactionMode,
  type SanitizeFn,
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

function roundMs(ms: number): number {
  return Number(Math.max(0, ms).toFixed(3));
}

function buildStages(
  parseMs: number,
  parsedUnits: number,
  timings: DetectTimings,
  stats: DetectionStats,
  redactMs: number,
  diffMs: number,
  changedLines: number,
): PipelineStageTiming[] {
  const otherMatched =
    stats.byType.EMAIL + stats.byType.PHONE + stats.byType.IP + stats.byType.PAN;
  return [
    {
      id: 'parse',
      label: 'Input Parse',
      durationMs: roundMs(parseMs),
      matchedCount: parsedUnits,
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

    const accTimings: DetectTimings = {
      scanMs: 0,
      luhnMs: 0,
      verhoeffMs: 0,
      validatorsMs: 0,
    };
    let detectTotalMs = 0;

    const timedSanitize: SanitizeFn = (cell, cellMode, state) => {
      const { result, timings } = sanitizeTextWithReplacements(cell, cellMode, state);
      accTimings.scanMs += timings.scanMs;
      accTimings.luhnMs += timings.luhnMs;
      accTimings.verhoeffMs += timings.verhoeffMs;
      accTimings.validatorsMs += timings.validatorsMs;
      detectTotalMs +=
        timings.scanMs + timings.luhnMs + timings.verhoeffMs + timings.validatorsMs;
      return result;
    };

    const csvStart = performance.now();
    const csvResult = sanitizeCsv(input, mode, timedSanitize);
    const redactMs = Math.max(0, performance.now() - csvStart - detectTotalMs);

    const diffStart = performance.now();
    const diffRows = buildCsvDiffRows(input, csvResult.sanitizedCsv, mode);
    const diffMs = performance.now() - diffStart;

    const changedLines = diffRows.filter((r) => r.hasChanges).length;
    const stages = buildStages(
      parseMs,
      parsedRows.length,
      accTimings,
      csvResult.stats,
      redactMs,
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

  const sanitizeStart = performance.now();
  const { result, replacements, timings } = sanitizeTextWithReplacements(input, mode);
  const detectTotalMs =
    timings.scanMs + timings.luhnMs + timings.verhoeffMs + timings.validatorsMs;
  const redactMs = Math.max(0, performance.now() - sanitizeStart - detectTotalMs);

  const diffStart = performance.now();
  const diffRows = buildSideBySideDiff(input, result.matches, mode, replacements);
  const diffMs = performance.now() - diffStart;

  const changedLines = diffRows.filter((r) => r.hasChanges).length;
  const stages = buildStages(
    parseMs,
    lineCount,
    timings,
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
    matches: result.matches,
  };
}
