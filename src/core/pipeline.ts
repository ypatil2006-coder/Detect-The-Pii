import { sanitizeCsv } from '../formats/csv';
import { buildSideBySideDiff } from './diff';
import { sanitizeText, sanitizeTextWithReplacements } from './redactor';
import {
  createPseudonymState,
  type DetectionStats,
  type DiffRow,
  type PseudonymMapEntry,
  type RedactionMode,
} from './types';

/** Complete sanitized output, statistics, pseudonyms, and diff rows for UI/worker consumers. */
export interface PipelineOutput {
  sanitized: string;
  mode: RedactionMode;
  kind: 'txt' | 'csv';
  stats: DetectionStats;
  pseudonyms: PseudonymMapEntry[];
  diffRows: DiffRow[];
  durationMs: number;
  rowCount?: number;
  columnCount?: number;
}

function buildCsvDiffRows(
  originalCsv: string,
  sanitizedCsv: string,
  mode: RedactionMode,
): DiffRow[] {
  const origLines = originalCsv.split('\n');
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

/** Runs end-to-end PII detection, redaction, and side-by-side diff generation for TXT or CSV input. */
export function runPipeline(
  input: string,
  kind: 'txt' | 'csv',
  mode: RedactionMode,
): PipelineOutput {
  const start = performance.now();

  if (kind === 'csv') {
    const csvResult = sanitizeCsv(input, mode, sanitizeText);
    const diffRows = buildCsvDiffRows(input, csvResult.sanitizedCsv, mode);

    return {
      sanitized: csvResult.sanitizedCsv,
      mode,
      kind,
      stats: csvResult.stats,
      pseudonyms: csvResult.pseudonyms,
      diffRows,
      durationMs: performance.now() - start,
      rowCount: csvResult.rowCount,
      columnCount: csvResult.columnCount,
    };
  }

  const { result, replacements } = sanitizeTextWithReplacements(input, mode);
  const diffRows = buildSideBySideDiff(input, result.matches, mode, replacements);

  return {
    sanitized: result.sanitized,
    mode,
    kind,
    stats: result.stats,
    pseudonyms: result.pseudonyms,
    diffRows,
    durationMs: performance.now() - start,
  };
}
