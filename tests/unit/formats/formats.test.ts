import { describe, expect, it } from 'vitest';
import {
  createEmptyStats,
  createPseudonymState,
  MAX_FILE_BYTES,
  type MappingEntry,
  type PseudonymMapEntry,
  type PseudonymState,
  type RedactionMode,
  type SanitizeFn,
} from '../../../src/core/types';
import {
  parseCsv,
  parseMapping,
  sanitizeCsv,
  serializeCsv,
  serializeMapping,
} from '../../../src/formats/csv';
import {
  detectFormat,
  formatLimitations,
  generateDocument,
  mappingFileName,
  outputFileName,
  parseDocument,
  validateFile,
} from '../../../src/formats/index';
import { readBlobText } from '../../../src/formats/segments';
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
      expect(buildDownloadFilename('C:\\fakepath\\tickets.csv', 'csv', 'pseudonym')).toBe(
        'tickets.sanitized-pseudonym.csv',
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

  it('handles empty CSV, BOM prefix, empty cells, trailing commas, and trailing newlines', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('\uFEFFa,,c\r\n1,2,\r\n')).toEqual([
      ['a', '', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('round-trips reversible mapping CSV with BOM, CRLF, special chars, and validation errors', () => {
    const entries: MappingEntry[] = [
      { code: 'USER_01', category: 'EMAIL', original: 'rahul@acme.com' },
      {
        code: 'CUSTOM_01',
        category: 'CUSTOM',
        original: '123, "Main" St\nFloor 2',
        prefix: '123',
        suffix: '2',
      },
    ];
    const csv = serializeMapping(entries);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('code,category,original,kept_prefix,kept_suffix');

    const parsed = parseMapping(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual(entries);

    const missingHeader = parseMapping('code,original\nUSER_01,rahul@acme.com\n');
    expect(missingHeader.entries).toEqual([]);
    expect(missingHeader.errors.length).toBeGreaterThan(0);

    const dupCode = parseMapping('code,category,original\nUSER_01,EMAIL,a@b.com\nUSER_01,EMAIL,c@d.com\n');
    expect(dupCode.entries).toHaveLength(1);
    expect(dupCode.errors.some((e) => e.includes('USER_01'))).toBe(true);

    const emptyCode = parseMapping('code,category,original\n,EMAIL,a@b.com\n');
    expect(emptyCode.entries).toEqual([]);
    expect(emptyCode.errors.length).toBeGreaterThan(0);

    const reordered = parseMapping('original,code,category,extra\nrahul@acme.com,USER_01,EMAIL,ignored\n');
    expect(reordered.errors).toEqual([]);
    expect(reordered.entries).toEqual([{ code: 'USER_01', category: 'EMAIL', original: 'rahul@acme.com' }]);
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

describe('multi-format dispatcher & plaintext helpers', () => {
  it('detects supported extensions and enforces 100 MB limit', () => {
    expect(detectFormat('notes.md')).toBe('md');
    expect(detectFormat('doc.markdown')).toBe('md');
    expect(detectFormat('report.docx')).toBe('docx');
    expect(detectFormat('sheet.xlsx')).toBe('xlsx');
    expect(detectFormat('scan.pdf')).toBe('pdf');
    expect(detectFormat('archive.zip')).toBeNull();

    expect(validateFile({ name: 'ok.pdf', size: MAX_FILE_BYTES })).toBe('pdf');
    expect(() => validateFile({ name: 'too-big.pdf', size: MAX_FILE_BYTES + 1 })).toThrow(/100 MB/);
    expect(() => validateFile({ name: 'bad.exe', size: 100 })).toThrow(/Unsupported/);
  });

  it('parses and regenerates Markdown via unified dispatcher', async () => {
    const file = new File(['# Note\nEmail: rahul@acme.example'], 'note.md', {
      type: 'text/markdown',
    });
    const doc = await parseDocument(file);
    expect(doc.format).toBe('md');
    const start = doc.text.indexOf('rahul@acme.example');
    const outBlob = await generateDocument(doc, [
      { start, end: start + 'rahul@acme.example'.length, replacement: 'USER_01' },
    ]);
    expect(await readBlobText(outBlob)).toBe('# Note\nEmail: USER_01');
  });

  it('builds output/mapping filenames and format limitation notices', () => {
    expect(outputFileName('C:\\fakepath\\audit.pdf', 'sanitized')).toBe('audit.sanitized.pdf');
    expect(mappingFileName('C:\\fakepath\\audit.pdf')).toBe('audit.mapping.csv');
    expect(formatLimitations('txt')).toBeNull();
    expect(formatLimitations('pdf', false)).toMatch(/coordinates/i);
    expect(formatLimitations('pdf', true)).toMatch(/OCR/i);
  });
});
