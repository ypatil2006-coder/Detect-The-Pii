import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { MappingEntry, RedactionItem } from '../../../src/core/types';
import {
  buildArchive,
  MAX_BATCH_FILES,
  manifestCsv,
  type RedactDocumentFn,
  uniqueNamer,
  validateBatchFiles,
} from '../../../src/formats/batch';
import { parseMapping } from '../../../src/formats/csv';
import { parsePlainText } from '../../../src/formats/plaintext';
import { readBlobBytes } from '../../../src/formats/segments';

const stubRedact: RedactDocumentFn = (_text, items, style) => {
  const active = items.filter((it) => it.active);
  const mappingMap = new Map<string, MappingEntry>();
  const edits = active.map((item) => {
    const replacement =
      style === 'pseudonym'
        ? item.code
        : style === 'category'
          ? `[${item.category}]`
          : style === 'blank'
            ? '○○○'
            : '[REDACTED]';
    if (style === 'pseudonym' && !mappingMap.has(item.code)) {
      mappingMap.set(item.code, {
        code: item.code,
        category: item.category,
        original: item.original,
      });
    }
    return { start: item.start, end: item.end, replacement };
  });
  return { edits, mapping: Array.from(mappingMap.values()) };
};

describe('batch format helpers', () => {
  it('disambiguates colliding archive filenames cleanly', () => {
    const unique = uniqueNamer();
    expect(unique('report.txt')).toBe('report.txt');
    expect(unique('report.txt')).toBe('report (2).txt');
    expect(unique('report.txt')).toBe('report (3).txt');
    expect(unique('README')).toBe('README');
    expect(unique('README')).toBe('README (2)');
  });

  it('builds RFC-4180 manifest.csv with BOM and CRLF', () => {
    const csv = manifestCsv([
      {
        source: 'a,b.txt',
        output: 'a,b.sanitized.txt',
        mapping: 'a,b.mapping.csv',
        count: 2,
      },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    expect(csv).toContain('"a,b.txt","a,b.sanitized.txt","a,b.mapping.csv",2');
  });

  it('enforces max 10 files per batch', () => {
    const eleven = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => new File(['hi'], `f${i}.txt`));
    const invalid = validateBatchFiles(eleven);
    expect(invalid.ok).toBe(false);

    const two = [new File(['hi'], 'a.txt'), new File(['hi'], 'b.md')];
    expect(validateBatchFiles(two)).toEqual({ ok: true });
  });

  it('packs sanitized outputs, disambiguated mapping CSVs, merged mapping, and manifest.csv', async () => {
    const doc1 = await parsePlainText(new File(['Email: rahul@acme.example'], 'ticket.txt'), 'txt');
    const doc2 = await parsePlainText(new File(['Email: rahul@acme.example'], 'ticket.md'), 'md');

    const item1: RedactionItem = {
      id: '1',
      category: 'EMAIL',
      original: 'rahul@acme.example',
      start: 7,
      end: 25,
      code: 'USER_01',
      origin: 'auto',
      active: true,
    };
    const item2: RedactionItem = { ...item1 };

    const { blob, manifest } = await buildArchive(
      [
        { doc: doc1, items: [item1] },
        { doc: doc2, items: [item2] },
      ],
      stubRedact,
      {
        style: 'pseudonym',
        merged: [{ code: 'USER_01', category: 'EMAIL', original: 'rahul@acme.example' }],
      },
    );

    const zip = await JSZip.loadAsync(await readBlobBytes(blob));
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      'manifest.csv',
      'merged.mapping.csv',
      'ticket.mapping (2).csv',
      'ticket.mapping.csv',
      'ticket.sanitized.md',
      'ticket.sanitized.txt',
    ]);

    expect(manifest[0]).toMatchObject({
      source: 'ticket.txt',
      output: 'ticket.sanitized.txt',
      mapping: 'ticket.mapping.csv',
      count: 1,
    });
    expect(manifest[1].mapping).toBe('ticket.mapping (2).csv');

    const outTxt = await zip.file('ticket.sanitized.txt')!.async('string');
    expect(outTxt).toBe('Email: USER_01');

    const mappingCsv = await zip.file('ticket.mapping.csv')!.async('string');
    expect(parseMapping(mappingCsv).entries).toEqual([
      { code: 'USER_01', category: 'EMAIL', original: 'rahul@acme.example' },
    ]);
  });

  it('omits mapping CSVs for non-reversible marker styles (full, partial, category, blank)', async () => {
    const doc = await parsePlainText(new File(['Email: rahul@acme.example'], 'note.txt'), 'txt');
    const item: RedactionItem = {
      id: '1',
      category: 'EMAIL',
      original: 'rahul@acme.example',
      start: 7,
      end: 25,
      code: 'USER_01',
      origin: 'auto',
      active: true,
    };

    for (const style of ['full', 'partial', 'category', 'blank'] as const) {
      const { blob, manifest } = await buildArchive([{ doc, items: [item] }], stubRedact, {
        style,
      });
      const zip = await JSZip.loadAsync(await readBlobBytes(blob));
      expect(Object.keys(zip.files).sort()).toEqual(['manifest.csv', 'note.sanitized.txt']);
      expect(manifest[0].mapping).toBe('');
      const manifestText = await zip.file('manifest.csv')!.async('string');
      expect(manifestText).not.toContain('mapping');
    }
  });
});
