import { buildMarker } from './codes';
import { detectPii } from './detector';
import {
  createPseudonymState,
  type MappingEntry,
  type MarkerStyle as CoreMarkerStyle,
  type PiiMatch,
  type PiiType,
  type PseudonymMapEntry,
  type PseudonymState,
  type RedactionItem,
  type RedactionMode,
  type SanitizeResult,
  type TextEdit,
} from './types';

export type DocumentMarkerStyle = CoreMarkerStyle | 'code' | 'label';

const PSEUDONYM_PREFIX: Record<PiiType, string> = {
  EMAIL: 'USER',
  PHONE: 'PHONE',
  IP: 'IP',
  PAN: 'PAN',
  AADHAAR: 'AADHAAR',
  CREDIT_CARD: 'CARD',
};

/** Formats a verification-preserving partial mask for a validated PII value. */
export function formatPartialMask(type: PiiType, raw: string): string {
  const trimmed = raw.trim();
  switch (type) {
    case 'CREDIT_CARD': {
      const digits = trimmed.replace(/\D/g, '');
      return `XXXX-XXXX-XXXX-${digits.slice(-4)}`;
    }
    case 'AADHAAR': {
      const digits = trimmed.replace(/\D/g, '');
      return `XXXX-XXXX-${digits.slice(-4)}`;
    }
    case 'EMAIL': {
      const atIdx = trimmed.indexOf('@');
      if (atIdx <= 0) {
        return '[REDACTED]';
      }
      return `${trimmed[0]}***${trimmed.slice(atIdx)}`;
    }
    case 'PAN': {
      if (trimmed.length !== 10) {
        return '[REDACTED]';
      }
      return `${trimmed.slice(0, 2)}***${trimmed.slice(5)}`;
    }
    case 'IP': {
      if (trimmed.includes('.')) {
        const parts = trimmed.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.***.***`;
        }
      }
      if (trimmed.includes(':')) {
        const firstGroup = trimmed.split(':')[0] || '****';
        return `${firstGroup}:****:****`;
      }
      return '***.***.***.***';
    }
    case 'PHONE': {
      const digits = trimmed.replace(/\D/g, '');
      const last4 = digits.slice(-4);
      if (trimmed.startsWith('+91') || /^91[6-9]\d{9}$/.test(digits)) {
        return `+91-XXXXXX${last4}`;
      }
      if (trimmed.startsWith('+') && digits.length > 10) {
        const cc = digits.slice(0, digits.length - 10);
        return `+${cc}-XXXXXX${last4}`;
      }
      return `XXXXXX${last4}`;
    }
  }
}

function getOrAssignPseudonym(match: PiiMatch, state: PseudonymState): string {
  const key = `${match.type}:${match.normalized}`;
  const existing = state.map.get(key);
  if (existing) {
    return existing;
  }

  state.counters[match.type] += 1;
  const placeholder = `${PSEUDONYM_PREFIX[match.type]}_${String(
    state.counters[match.type],
  ).padStart(2, '0')}`;
  state.map.set(key, placeholder);
  return placeholder;
}

/**
 * Detects PII in text, applies the selected redaction mode, and returns both
 * the full `SanitizeResult` and per-match replacement strings for diff building.
 */
export function sanitizeTextWithReplacements(
  text: string,
  mode: RedactionMode,
  sharedState?: PseudonymState,
): { result: SanitizeResult; replacements: string[] } {
  const start = performance.now();
  const { matches, stats } = detectPii(text);
  const state = sharedState ?? createPseudonymState();
  const summaryByPlaceholder = new Map<string, PseudonymMapEntry>();

  if (matches.length === 0) {
    return {
      result: {
        original: text,
        sanitized: text,
        mode,
        matches,
        stats,
        pseudonyms: [],
        durationMs: performance.now() - start,
      },
      replacements: [],
    };
  }

  let cursor = 0;
  let sanitized = '';
  const replacements: string[] = [];

  for (const match of matches) {
    sanitized += text.slice(cursor, match.start);

    let replacement: string;
    if (mode === 'full') {
      replacement = '[REDACTED]';
    } else if (mode === 'partial') {
      replacement = formatPartialMask(match.type, match.value);
    } else {
      replacement = getOrAssignPseudonym(match, state);
      const entry = summaryByPlaceholder.get(replacement);
      if (entry) {
        entry.count += 1;
      } else {
        summaryByPlaceholder.set(replacement, {
          placeholder: replacement,
          type: match.type,
          maskedPreview: formatPartialMask(match.type, match.value),
          count: 1,
        });
      }
    }

    replacements.push(replacement);
    sanitized += replacement;
    cursor = match.end;
  }
  sanitized += text.slice(cursor);

  return {
    result: {
      original: text,
      sanitized,
      mode,
      matches,
      stats,
      pseudonyms: Array.from(summaryByPlaceholder.values()),
      durationMs: performance.now() - start,
    },
    replacements,
  };
}

/** Detects PII in text and applies the selected redaction mode. */
export function sanitizeText(
  text: string,
  mode: RedactionMode,
  sharedState?: PseudonymState,
): SanitizeResult {
  return sanitizeTextWithReplacements(text, mode, sharedState).result;
}

/* -------------------------------------------------------------------------- */
/* Multi-format document redaction edits & reversible mapping generation       */
/* -------------------------------------------------------------------------- */

/** Replaces every letter or digit with `○`, keeping separators intact. */
export const blankOut = (s: string): string => s.replace(/[\p{L}\p{N}]/gu, '○');

export interface RedactionResult {
  redactedText: string;
  edits: TextEdit[];
  mapping: MappingEntry[];
}

/** Splits an item's original text into kept prefix, hidden part, and kept suffix. */
export function splitItem(it: RedactionItem): {
  prefix: string;
  hidden: string;
  suffix: string;
} {
  const head = it.head ?? 0;
  const tail = it.tail ?? 0;
  const o = it.original;
  return {
    prefix: o.slice(0, head),
    hidden: o.slice(head, o.length - tail),
    suffix: o.slice(o.length - tail),
  };
}

/** Computes the output text for a single `RedactionItem` under `style`. */
export function outputFor(
  it: RedactionItem,
  style: DocumentMarkerStyle = 'code',
): string {
  if (style === 'full') {
    return '[REDACTED]';
  }
  const { prefix, hidden, suffix } = splitItem(it);
  let marker: string;
  if (style === 'code' || style === 'pseudonym') {
    marker = buildMarker(it.category, it.code);
  } else if (style === 'label' || style === 'category') {
    marker = `[${it.category}]`;
  } else if (style === 'partial') {
    marker = blankOut(hidden);
  } else {
    marker = blankOut(hidden);
  }
  return prefix + marker + suffix;
}

/** On-screen stand-in label showing `[CATEGORY]` without exposing random hex codes. */
export function previewLabel(
  it: RedactionItem,
  style: DocumentMarkerStyle = 'code',
): string {
  return outputFor(
    it,
    style === 'code' || style === 'pseudonym' ? 'label' : style,
  );
}

/** True when the item retains any leading or trailing characters outside its marker. */
export function isPartial(it: RedactionItem): boolean {
  return Boolean(it.head || it.tail);
}

/** Builds sorted non-overlapping `TextEdit[]` for active items. */
export function buildEdits(
  items: RedactionItem[],
  style: DocumentMarkerStyle = 'code',
): TextEdit[] {
  return items
    .filter((it) => it.active)
    .sort((a, b) => a.start - b.start)
    .map((it) => ({
      start: it.start,
      end: it.end,
      replacement: outputFor(it, style),
    }));
}

/** Applies sorted non-overlapping `TextEdit[]` to `text`. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) {
      throw new Error('Overlapping edit ranges.');
    }
    out += text.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  return out + text.slice(cursor);
}

/** Applies redactions to `text` and builds the reversible `MappingEntry[]` table. */
export function applyRedactions(
  text: string,
  items: RedactionItem[],
  style: DocumentMarkerStyle = 'code',
): RedactionResult {
  const edits = buildEdits(items, style);
  const mapping: MappingEntry[] = [];
  const seen = new Set<string>();
  const activeSorted =
    style === 'code' || style === 'pseudonym'
      ? [...items].filter((it) => it.active).sort((a, b) => a.start - b.start)
      : [];

  for (const it of activeSorted) {
    if (seen.has(it.code)) {
      continue;
    }
    seen.add(it.code);
    const { prefix, hidden, suffix } = splitItem(it);
    const entry: MappingEntry = {
      code: it.code,
      category: it.category,
      original: hidden,
    };
    if (prefix) {
      entry.prefix = prefix;
    }
    if (suffix) {
      entry.suffix = suffix;
    }
    mapping.push(entry);
  }

  return { redactedText: applyEdits(text, edits), edits, mapping };
}

/** Merges multiple mapping tables, keeping the first occurrence of each `code`. */
export function mergeMappings(...lists: MappingEntry[][]): MappingEntry[] {
  const seen = new Set<string>();
  const out: MappingEntry[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (seen.has(e.code)) {
        continue;
      }
      seen.add(e.code);
      out.push(e);
    }
  }
  return out;
}
