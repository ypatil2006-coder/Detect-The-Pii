import {
  createEmptyStats,
  createPseudonymState,
  type DetectionStats,
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
