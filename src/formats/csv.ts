import {
  createEmptyStats,
  createPseudonymState,
  type DetectionStats,
  type MappingEntry,
  type PiiType,
  type PseudonymMapEntry,
  type RedactionMode,
  type SanitizeFn,
} from '../core/types';

const PII_TYPES: readonly PiiType[] = [
  'EMAIL',
  'PHONE',
  'IP',
  'PAN',
  'AADHAAR',
  'CREDIT_CARD',
];

export interface SanitizeCsvResult {
  sanitizedCsv: string;
  stats: DetectionStats;
  pseudonyms: PseudonymMapEntry[];
  rowCount: number;
  columnCount: number;
}

/**
 * Parses RFC-4180 CSV text into a 2D array of cell strings, preserving
 * quoted commas, escaped double quotes (`""`), and embedded newlines.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (input.length === 0) {
    return [];
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (atFieldStart && ch === '"') {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      atFieldStart = true;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atFieldStart = true;
      continue;
    }

    field += ch;
    atFieldStart = false;
  }

  if (!atFieldStart || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function formatCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serializes a 2D array of cells back into valid RFC-4180 CSV text.
 */
export function serializeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(formatCsvCell).join(',')).join('\n');
}

const BOM = '\uFEFF';
const REQUIRED_MAPPING_HEADERS = ['code', 'category', 'original'] as const;
const KEPT_MAPPING_HEADERS = ['kept_prefix', 'kept_suffix'] as const;

export const parseCsvRows = parseCsv;

export interface ParseMappingResult {
  entries: MappingEntry[];
  errors: string[];
}

/**
 * Serializes reversible redaction mapping entries into a UTF-8 BOM + CRLF CSV.
 * `kept_prefix` and `kept_suffix` columns are included only when at least one entry retains context.
 */
export function serializeMapping(entries: MappingEntry[]): string {
  const hasKept = entries.some((e) => Boolean(e.prefix || e.suffix));
  const headers = [...REQUIRED_MAPPING_HEADERS, ...(hasKept ? KEPT_MAPPING_HEADERS : [])];
  const lines = [headers.join(',')];
  for (const entry of entries) {
    const fields = [entry.code, entry.category, entry.original];
    if (hasKept) {
      fields.push(entry.prefix ?? '', entry.suffix ?? '');
    }
    lines.push(fields.map(formatCsvCell).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * Parses a `.mapping.csv` table by header name and validates required columns,
 * non-empty codes, and duplicate codes.
 */
export function parseMapping(text: string): ParseMappingResult {
  const errors: string[] = [];
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ''));
  if (rows.length === 0) {
    return { entries: [], errors: ['Mapping CSV is empty.'] };
  }

  const header = rows[0].map((h) => h.trim());
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    idx[h] = i;
  });

  for (const required of REQUIRED_MAPPING_HEADERS) {
    if (!(required in idx)) {
      errors.push(`Missing required column: ${required}`);
    }
  }
  if (errors.length > 0) {
    return { entries: [], errors };
  }

  const entries: MappingEntry[] = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((row, rowIndex) => {
    const lineNo = rowIndex + 2;
    const code = (row[idx.code] ?? '').trim();
    const category = row[idx.category] ?? '';
    const original = row[idx.original] ?? '';

    if (!code) {
      errors.push(`Row ${lineNo}: code is empty.`);
      return;
    }
    if (seen.has(code)) {
      errors.push(`Row ${lineNo}: duplicate code "${code}".`);
      return;
    }
    seen.add(code);

    const entry: MappingEntry = { code, category, original };
    const prefix = 'kept_prefix' in idx ? (row[idx.kept_prefix] ?? '') : '';
    const suffix = 'kept_suffix' in idx ? (row[idx.kept_suffix] ?? '') : '';
    if (prefix) entry.prefix = prefix;
    if (suffix) entry.suffix = suffix;
    entries.push(entry);
  });

  return { entries, errors };
}

/**
 * Sanitizes every cell in a CSV document using one shared `PseudonymState`
 * so recurring entities map deterministically across all rows and columns.
 */
export function sanitizeCsv(
  csvText: string,
  mode: RedactionMode,
  sanitizeFn: SanitizeFn,
): SanitizeCsvResult {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return {
      sanitizedCsv: '',
      stats: createEmptyStats(),
      pseudonyms: [],
      rowCount: 0,
      columnCount: 0,
    };
  }

  const sharedState = createPseudonymState();
  const stats = createEmptyStats();
  const pseudonymMap = new Map<string, PseudonymMapEntry>();
  let columnCount = 0;

  const sanitizedRows = rows.map((row) => {
    if (row.length > columnCount) {
      columnCount = row.length;
    }

    return row.map((cell) => {
      const result = sanitizeFn(cell, mode, sharedState);
      stats.total += result.stats.total;
      stats.rejectedCreditCards += result.stats.rejectedCreditCards;
      stats.rejectedAadhaar += result.stats.rejectedAadhaar;

      for (const type of PII_TYPES) {
        stats.byType[type] += result.stats.byType[type];
      }

      for (const entry of result.pseudonyms) {
        const existing = pseudonymMap.get(entry.placeholder);
        if (existing) {
          existing.count += entry.count;
        } else {
          pseudonymMap.set(entry.placeholder, { ...entry });
        }
      }

      return result.sanitized;
    });
  });

  return {
    sanitizedCsv: serializeCsv(sanitizedRows),
    stats,
    pseudonyms: Array.from(pseudonymMap.values()),
    rowCount: rows.length,
    columnCount,
  };
}
