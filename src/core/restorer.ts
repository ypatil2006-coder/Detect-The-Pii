import type { MappingEntry, TextEdit } from './types';
import { MARKER_REGEX, parseMarkers } from './codes';
import { applyEdits } from './redactor';

export interface RestoreResult {
  restoredText: string;
  edits: TextEdit[];
  missingCodes: string[];
  restoredCount: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Restores `[CATEGORY:hex6]` markers and deterministic pseudonym tokens (e.g. `USER_01`)
 * in `text` back to their original values using `mapping`; unmapped `[CATEGORY:hex6]`
 * markers are reported in `missingCodes`.
 */
export function restore(text: string, mapping: MappingEntry[]): RestoreResult {
  const table = new Map(mapping.map((m) => [m.code, m.original]));
  const edits: TextEdit[] = [];
  const missing = new Set<string>();

  for (const mk of parseMarkers(text)) {
    const original = table.get(mk.code);
    if (original === undefined) {
      missing.add(mk.code);
      continue;
    }
    edits.push({ start: mk.start, end: mk.end, replacement: original });
  }

  // Also restore standalone pseudonym tokens (e.g. USER_01, CARD_01) present in mapping
  const nonHexEntries = mapping.filter(
    (m) => m.code && !/^[0-9a-f]{6}$/.test(m.code) && !MARKER_REGEX.test(m.code),
  );
  if (nonHexEntries.length > 0) {
    const sortedTokens = [...nonHexEntries].sort(
      (a, b) => b.code.length - a.code.length,
    );
    const tokenRegex = new RegExp(
      `(?<![A-Za-z0-9_])${sortedTokens.map((e) => escapeRegExp(e.code)).join('|')}(?![A-Za-z0-9_])`,
      'g',
    );
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const overlaps = edits.some((e) => start < e.end && end > e.start);
      if (overlaps) {
        continue;
      }
      const original = table.get(m[0]);
      if (original !== undefined) {
        edits.push({ start, end, replacement: original });
      }
    }
  }

  edits.sort((a, b) => a.start - b.start);

  return {
    restoredText: applyEdits(text, edits),
    edits,
    missingCodes: [...missing],
    restoredCount: edits.length,
  };
}
