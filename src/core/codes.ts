import type { MappingEntry } from './types';

export const CODE_LENGTH = 6;

export const MARKER_REGEX = /\[([^[\]:]{1,20}):([0-9a-f]{6})\]/g;

/** Generates a random 6-character hex code guaranteed not to collide with `used`. */
export function generateCode(used: Set<string>): string {
  const bytes = new Uint8Array(CODE_LENGTH / 2);
  for (let attempt = 0; attempt < 1000; attempt++) {
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  throw new Error('Unable to generate a unique redaction code');
}

/**
 * Deterministic code assignment within a document or across a batch.
 * Identical (category, original, head, tail) tuples share one 6-hex code.
 */
export class CodeBook {
  private readonly used = new Set<string>();
  private readonly byValue = new Map<string, string>();

  private static key(
    category: string,
    original: string,
    head: number,
    tail: number,
  ): string {
    return `${category}:${head}:${tail}:${original}`;
  }

  codeFor(category: string, original: string, head = 0, tail = 0): string {
    const key = CodeBook.key(category, original, head, tail);
    let code = this.byValue.get(key);
    if (code === undefined) {
      code = generateCode(this.used);
      this.byValue.set(key, code);
    }
    return code;
  }

  /** Seeds codes from an imported mapping table; warns if one value maps to multiple codes. */
  seed(entries: MappingEntry[]): string[] {
    const warnings: string[] = [];
    for (const e of entries) {
      this.used.add(e.code);
      const prefix = e.prefix ?? '';
      const suffix = e.suffix ?? '';
      const key = CodeBook.key(
        e.category,
        prefix + e.original + suffix,
        prefix.length,
        suffix.length,
      );
      const existing = this.byValue.get(key);
      if (existing === undefined) {
        this.byValue.set(key, e.code);
      } else if (existing !== e.code) {
        warnings.push(
          `Duplicate mapping for ${e.category}: value already mapped to ${existing}, ignoring ${e.code}`,
        );
      }
    }
    return warnings;
  }
}

/** Formats a reversible marker token `[CATEGORY:abcdef]`. */
export function buildMarker(category: string, code: string): string {
  return `[${category}:${code}]`;
}

export interface ParsedMarker {
  category: string;
  code: string;
  start: number;
  end: number;
}

/** Finds all reversible `[CATEGORY:hex6]` markers in text in ascending offset order. */
export function parseMarkers(text: string): ParsedMarker[] {
  const out: ParsedMarker[] = [];
  const re = new RegExp(MARKER_REGEX.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      category: m[1],
      code: m[2],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}
