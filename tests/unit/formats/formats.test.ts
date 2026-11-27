import { describe, expect, it } from 'vitest';
import {
  createEmptyStats,
  createPseudonymState,
  type PseudonymMapEntry,
  type PseudonymState,
  type RedactionMode,
  type SanitizeFn,
} from '../../../src/core/types';
import { parseCsv, sanitizeCsv, serializeCsv } from '../../../src/formats/csv';
import {
  buildDownloadFilename,
  sanitizeTxt,
  validateUploadFile,
} from '../../../src/formats/txt';

describe('txt format helpers', () => {
  describe('validateUploadFile', () => {
    it('accepts .txt and .csv files case-insensitively within size limit', () => {
      expect(validateUploadFile({ name: 'notes.txt', size: 1024 })).toEqual({
        ok: true,
        kind: 'txt',
      });
      expect(validateUploadFile({ name: 'DATA.CSV', size: 2048 })).toEqual({
        ok: true,
        kind: 'csv',
      });
    });

    it('rejects unsupported extensions, empty files, and oversized files', () => {
      const exeResult = validateUploadFile({ name: 'payload.exe', size: 512 });
      expect(exeResult.ok).toBe(false);

      const pdfResult = validateUploadFile({ name: 'report.pdf', size: 512 });
      expect(pdfResult.ok).toBe(false);

      const emptyResult = validateUploadFile({ name: 'empty.txt', size: 0 });
      expect(emptyResult.ok).toBe(false);

      const largeResult = validateUploadFile({ name: 'huge.csv', size: 11 * 1024 * 1024 });
      expect(largeResult.ok).toBe(false);
    });
  });

  describe('buildDownloadFilename', () => {
    it('builds mode-aware sanitized filenames for uploaded files and pasted text', () => {
      expect(buildDownloadFilename('tickets.csv', 'csv', 'pseudonym')).toBe(
        'tickets.sanitized-pseudonym.csv',
      );
      expect(buildDownloadFilename('Server.Log.TXT', 'txt', 'full')).toBe(
        'Server.Log.sanitized-full.txt',
      );
      expect(buildDownloadFilename(null, 'txt', 'partial')).toBe(
        'sanitized-output.sanitized-partial.txt',
      );
    });
  });

  describe('sanitizeTxt', () => {
    it('normalizes BOM and CRLF line endings before delegating to sanitizeFn', () => {
      const stubSanitize: SanitizeFn = (text, mode) => ({
        original: text,
        sanitized: text.replace('rahul@acme.com', mode === 'full' ? '[REDACTED]' : 'USER_01'),
        mode,
        matches: [],
        stats: createEmptyStats(),
        pseudonyms: [],
        durationMs: 0,
      });

      const result = sanitizeTxt('\uFEFFline1\r\nrahul@acme.com\rline3', 'full', stubSanitize);
      expect(result.original).toBe('line1\nrahul@acme.com\nline3');
      expect(result.sanitized).toBe('line1\n[REDACTED]\nline3');
    });
  });
});

describe('csv format helpers', () => {
  it('round-trips RFC-4180 quoted commas, escaped double quotes, and embedded newlines', () => {
    const csv = [
      'name,notes,email',
      '"Sharma, Rahul","He said ""hi""\nLine 2",rahul@acme.com',
      '"Nair, Priya","Plain, note",priya@acme.com',
    ].join('\r\n');

    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ['name', 'notes', 'email'],
      ['Sharma, Rahul', 'He said "hi"\nLine 2', 'rahul@acme.com'],
      ['Nair, Priya', 'Plain, note', 'priya@acme.com'],
    ]);

    expect(serializeCsv(rows)).toBe(
      [
        'name,notes,email',
        '"Sharma, Rahul","He said ""hi""\nLine 2",rahul@acme.com',
        '"Nair, Priya","Plain, note",priya@acme.com',
      ].join('\n'),
    );
  });

  it('handles empty CSV and trailing newlines without phantom rows', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('shares PseudonymState across CSV rows, aggregates stats, and preserves quoting', () => {
    const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    const stubSanitize: SanitizeFn = (text, mode: RedactionMode, sharedState?: PseudonymState) => {
      const state = sharedState ?? createPseudonymState();
      const stats = createEmptyStats();
      const pseudonyms: PseudonymMapEntry[] = [];

      const sanitized = text.replace(emailRegex, (raw) => {
        const key = `EMAIL:${raw.toLowerCase()}`;
        let token = state.map.get(key);
        if (!token) {
          state.counters.EMAIL += 1;
          token = `USER_${String(state.counters.EMAIL).padStart(2, '0')}`;
          state.map.set(key, token);
        }
        const replacement = mode === 'full' ? '[REDACTED]' : token;
        stats.total += 1;
        stats.byType.EMAIL += 1;
        pseudonyms.push({
          placeholder: token,
          type: 'EMAIL',
          maskedPreview: `${raw[0]}***`,
          count: 1,
        });
        return replacement;
      });

      return {
        original: text,
        sanitized,
        mode,
        matches: [],
        stats,
        pseudonyms,
        durationMs: 0,
      };
    };

    const inputCsv = [
      'customer,contact,comment',
      '"Sharma, Rahul",rahul@acme.com,"Contact rahul@acme.com, urgent"',
      '"Nair, Priya",priya@acme.com,"CC: rahul@acme.com"',
    ].join('\n');

    const result = sanitizeCsv(inputCsv, 'pseudonym', stubSanitize);
    expect(result.rowCount).toBe(3);
    expect(result.columnCount).toBe(3);
    expect(result.stats.total).toBe(4);
    expect(result.stats.byType.EMAIL).toBe(4);
    expect(result.pseudonyms).toEqual([
      { placeholder: 'USER_01', type: 'EMAIL', maskedPreview: 'r***', count: 3 },
      { placeholder: 'USER_02', type: 'EMAIL', maskedPreview: 'p***', count: 1 },
    ]);

    const reparsed = parseCsv(result.sanitizedCsv);
    expect(reparsed).toEqual([
      ['customer', 'contact', 'comment'],
      ['Sharma, Rahul', 'USER_01', 'Contact USER_01, urgent'],
      ['Nair, Priya', 'USER_02', 'CC: USER_01'],
    ]);
  });
});
