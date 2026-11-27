import type { Category, Retention } from './types';
import { birthYearSplit, phonePrefixLength } from './validators';

export type RetentionMode = Retention['mode'];

export interface Split {
  head: number;
  tail: number;
}

const NONE: Split = { head: 0, tail: 0 };

/** Lists available retention modes for a given PII category. */
export function modesFor(_category: Category): RetentionMode[] {
  void _category;
  return ['none', 'ends', 'delim', 'preview'];
}

export const MODE_LABELS: Record<RetentionMode, string> = {
  none: 'Hide all',
  ends: 'Keep leading / trailing characters',
  delim: 'Keep around delimiter',
  preview: 'Partial mask (standard)',
};

/** Human-readable description of a retention configuration. */
export function describeRetention(r: Retention | undefined): string {
  if (!r) {
    return MODE_LABELS.none;
  }
  switch (r.mode) {
    case 'ends': {
      const parts = [
        r.head > 0 ? `first ${r.head}` : '',
        r.tail > 0 ? `last ${r.tail}` : '',
      ].filter(Boolean);
      return parts.length ? `Keep ${parts.join(' + ')} chars` : MODE_LABELS.none;
    }
    case 'delim':
      return `Keep ${r.side} "${r.delimiter}"`;
    default:
      return MODE_LABELS[r.mode];
  }
}

/**
 * Standard partial retention split per category: exposes only low-sensitivity
 * structural prefixes/suffixes (e.g. email domain, last 4 card digits, IP prefix).
 */
export function standardSplit(category: Category, value: string): Split {
  switch (category) {
    case 'EMAIL': {
      const at = value.indexOf('@');
      return at > 0 ? { head: 0, tail: value.length - at } : NONE;
    }
    case 'PHONE':
      return { head: phonePrefixLength(value), tail: 0 };
    case 'IP':
      return {
        head:
          value.match(/^(?:\d{1,3}\.){2}|^(?:[0-9a-f]{0,4}:){2}/i)?.[0].length ?? 0,
        tail: 0,
      };
    case 'PAN':
      return { head: 2, tail: 0 };
    case 'AADHAAR':
      return { head: 0, tail: 4 };
    case 'CREDIT_CARD': {
      let start = value.length;
      for (let digits = 0; start > 0 && digits < 4; ) {
        if (/\d/.test(value[--start])) {
          digits++;
        }
      }
      return { head: 0, tail: value.length - start };
    }
    case 'SSN':
      return NONE;
    case 'IBAN':
      return { head: 2, tail: 0 };
    case 'DOB':
      return birthYearSplit(value);
    case 'CUSTOM':
    default:
      return { head: 1, tail: 0 };
  }
}

function rawSplit(value: string, r: Retention, category: Category): Split {
  switch (r.mode) {
    case 'none':
      return NONE;
    case 'preview':
      return standardSplit(category, value);
    case 'ends':
      return { head: r.head, tail: r.tail };
    case 'delim': {
      if (!r.delimiter) {
        return NONE;
      }
      if (r.side === 'after') {
        const i = value.indexOf(r.delimiter);
        return i < 0 ? NONE : { head: 0, tail: value.length - i };
      }
      const i = value.lastIndexOf(r.delimiter);
      return i < 0 ? NONE : { head: i + r.delimiter.length, tail: 0 };
    }
  }
}

/**
 * Computes kept character counts at each end of `value`; falls back to hiding
 * everything unless at least one character remains hidden.
 */
export function splitFor(
  value: string,
  r: Retention | undefined,
  category: Category = 'CUSTOM',
): Split {
  if (!r) {
    return NONE;
  }
  const s = rawSplit(value, r, category);
  if (s.head < 0 || s.tail < 0 || s.head + s.tail >= value.length) {
    return NONE;
  }
  return s;
}

/** Extracts the first example value from a comma-separated rule example string. */
export function firstExample(example: string): string {
  return example.split(/[、,，]/)[0].trim();
}

export interface RetentionCheck {
  error: string | null;
  warnings: string[];
}

/** Validates a retention configuration against a rule's example value. */
export function checkRetention(
  example: string,
  r: Retention,
  category: Category = 'CUSTOM',
): RetentionCheck {
  const warnings: string[] = [];
  if (r.mode === 'preview') {
    warnings.push(
      'Partial mask retains structural characters (e.g. domain or last 4 digits) and is not full anonymization.',
    );
  }
  if (r.mode === 'ends') {
    if (
      !Number.isInteger(r.head) ||
      !Number.isInteger(r.tail) ||
      r.head < 0 ||
      r.tail < 0
    ) {
      return {
        error: 'Kept character counts must be non-negative integers.',
        warnings,
      };
    }
    if (r.head > 0 && r.tail > 0) {
      warnings.push(
        'Keeping both leading and trailing characters increases re-identification risk.',
      );
    }
  }
  if (r.mode === 'delim' && !r.delimiter) {
    return { error: 'Please enter a delimiter.', warnings };
  }
  if (r.mode !== 'ends' && r.mode !== 'delim' && r.mode !== 'preview') {
    return { error: null, warnings };
  }

  const ex = firstExample(example);
  if (!ex) {
    return { error: null, warnings };
  }
  if (r.mode === 'delim' && !ex.includes(r.delimiter)) {
    warnings.push(
      `Example "${ex}" does not contain "${r.delimiter}", so matching values will be fully hidden.`,
    );
    return { error: null, warnings };
  }
  const raw = rawSplit(ex, r, category);
  const hidden = ex.length - raw.head - raw.tail;
  if (r.mode === 'preview') {
    return { error: null, warnings };
  }
  if (hidden <= 0) {
    return {
      error: `This setting leaves the entire example "${ex}" visible; at least 1 character must be hidden.`,
      warnings,
    };
  }
  if (hidden < ex.length / 2) {
    warnings.push(
      `Only ${hidden} of ${ex.length} characters in "${ex}" are hidden (less than half).`,
    );
  }
  return { error: null, warnings };
}

/** Sanitizes persisted retention settings read back from browser storage. */
export function sanitizeRetention(x: unknown): Retention | null {
  if (!x || typeof x !== 'object') {
    return null;
  }
  const r = x as Record<string, unknown>;
  switch (r.mode) {
    case 'none':
    case 'preview':
      return { mode: r.mode };
    case 'ends':
      return Number.isInteger(r.head) &&
        Number.isInteger(r.tail) &&
        (r.head as number) >= 0 &&
        (r.tail as number) >= 0
        ? { mode: 'ends', head: r.head as number, tail: r.tail as number }
        : null;
    case 'delim':
      return typeof r.delimiter === 'string' &&
        r.delimiter &&
        (r.side === 'before' || r.side === 'after')
        ? { mode: 'delim', delimiter: r.delimiter, side: r.side }
        : null;
    default:
      return null;
  }
}
