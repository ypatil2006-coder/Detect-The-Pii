import type { DiffRow, DiffSegment, PiiMatch, RedactionMode } from './types';

/**
 * Builds line-aligned Original vs. Sanitized diff rows from source text,
 * validated non-overlapping matches, and their mode-specific replacements.
 */
export function buildSideBySideDiff(
  original: string,
  matches: PiiMatch[],
  mode: RedactionMode,
  replacements: string[],
): DiffRow[] {
  const rawLines = original.split('\n');
  const rows: DiffRow[] = [];

  let lineStart = 0;
  let matchIdx = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const hasCr = rawLine.endsWith('\r');
    const visibleLength = hasCr ? rawLine.length - 1 : rawLine.length;
    const lineEnd = lineStart + visibleLength;

    while (matchIdx < matches.length && matches[matchIdx].end <= lineStart) {
      matchIdx++;
    }

    const originalSegments: DiffSegment[] = [];
    const sanitizedSegments: DiffSegment[] = [];
    let cursor = lineStart;
    let hasChanges = false;

    let j = matchIdx;
    while (j < matches.length && matches[j].start < lineEnd) {
      const match = matches[j];
      const spanStart = Math.max(match.start, lineStart);
      const spanEnd = Math.min(match.end, lineEnd);

      if (spanStart > cursor) {
        const plain = original.slice(cursor, spanStart);
        originalSegments.push({ text: plain, kind: 'plain' });
        sanitizedSegments.push({ text: plain, kind: 'plain' });
      }

      const rawValue = original.slice(spanStart, spanEnd);
      const replacement = replacements[j] ?? '[REDACTED]';

      originalSegments.push({
        text: rawValue,
        kind: 'pii',
        type: match.type,
      });

      const redactedSeg: DiffSegment = {
        text: replacement,
        kind: 'redacted',
        type: match.type,
      };
      if (mode === 'pseudonym') {
        redactedSeg.placeholder = replacement;
      }
      sanitizedSegments.push(redactedSeg);

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

    matchIdx = j;
    lineStart += rawLine.length + 1;
  }

  return rows;
}
