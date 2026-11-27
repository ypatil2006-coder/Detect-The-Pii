import { describe, expect, it } from 'vitest';
import { CodeBook } from '../../src/core/codes';
import { detect } from '../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { applyRedactions } from '../../src/core/redactor';
import { restore } from '../../src/core/restorer';
import type { Pattern } from '../../src/core/types';
import { generateDocx, parseDocx } from '../../src/formats/docx';
import { buildSampleDocxFile, buildSampleXlsxFile } from '../../src/formats/samples';
import { readBlobBytes } from '../../src/formats/segments';
import { generateXlsx, parseXlsx } from '../../src/formats/xlsx';

const PREVIEW_PATTERNS: Pattern[] = BUILTIN_PATTERNS.map((p) => ({
  ...p,
  retention: { mode: 'preview' },
}));

describe('roundtrip with partial retention across DOCX and XLSX', () => {
  it('docx: keeps retained prefixes/suffixes outside codes and restores verbatim', async () => {
    const doc = await parseDocx(await buildSampleDocxFile('ret.docx'));
    const book = new CodeBook();
    const items = detect(doc.text, PREVIEW_PATTERNS, book);
    expect(items.some((i) => Boolean(i.head || i.tail))).toBe(true);

    const { edits, mapping } = applyRedactions(doc.text, items, 'code');
    const outBlob = await generateDocx(doc, edits);
    const outDoc = await parseDocx(
      new File([(await readBlobBytes(outBlob)) as BlobPart], 'out.docx'),
    );

    expect(outDoc.text).toMatch(/AB\[PAN:[0-9a-f]{6}\]/);
    expect(outDoc.text).toMatch(/\[CREDIT_CARD:[0-9a-f]{6}\]1111/);
    expect(outDoc.text).not.toContain('ABCPA1234F');
    expect(restore(outDoc.text, mapping).restoredText).toBe(doc.text);
  });

  it('xlsx: keeps retained prefixes/suffixes outside codes and restores verbatim', async () => {
    const doc = await parseXlsx(await buildSampleXlsxFile('ret.xlsx'));
    const book = new CodeBook();
    const items = detect(doc.text, PREVIEW_PATTERNS, book);
    const { edits, mapping } = applyRedactions(doc.text, items, 'code');

    const outBlob = await generateXlsx(doc, edits);
    const outDoc = await parseXlsx(
      new File([(await readBlobBytes(outBlob)) as BlobPart], 'out.xlsx'),
    );

    expect(outDoc.text).toMatch(/\[EMAIL:[0-9a-f]{6}\]@acme\.example/);
    expect(outDoc.text).toMatch(/\[AADHAAR:[0-9a-f]{6}\]0124/);
    expect(outDoc.text).not.toContain('rahul.sharma@acme.example');
    expect(restore(outDoc.text, mapping).restoredText).toBe(doc.text);
  });
});
