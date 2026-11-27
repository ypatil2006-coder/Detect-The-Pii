import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { analyzeDocument } from '../../src/core/document-pipeline';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { applyRedactions, mergeMappings } from '../../src/core/redactor';
import { restore } from '../../src/core/restorer';
import { createPseudonymState, type MarkerStyle } from '../../src/core/types';
import { buildArchive, MERGED_MAPPING_NAME, type RedactDocumentFn } from '../../src/formats/batch';
import { parseMapping } from '../../src/formats/csv';
import { parseDocx } from '../../src/formats/docx';
import { parsePlainText } from '../../src/formats/plaintext';
import { buildSampleDocxFile, buildSampleXlsxFile, getSampleById } from '../../src/formats/samples';
import { readBlobBytes } from '../../src/formats/segments';
import { parseXlsx } from '../../src/formats/xlsx';

describe('batch archive integration across TXT, MD, DOCX, XLSX', () => {
  it('bundles multi-format batch with shared pseudonyms, merged.mapping.csv, and manifest.csv', async () => {
    const sharedState = createPseudonymState();
    const txtDoc = await parsePlainText(
      new File([getSampleById('support-log').content], 'ticket.txt'),
      'txt',
    );
    const mdDoc = await parsePlainText(
      new File(['Owner: rahul.sharma@acme.example\nPAN: ABCPA1234F'], 'ticket.md'),
      'md',
    );
    const docxDoc = await parseDocx(await buildSampleDocxFile('audit.docx'));
    const xlsxDoc = await parseXlsx(await buildSampleXlsxFile('customers.xlsx'));

    const sessions = [txtDoc, mdDoc, docxDoc, xlsxDoc].map((doc) =>
      analyzeDocument(doc, BUILTIN_PATTERNS, 'pseudonym', sharedState),
    );
    const merged = mergeMappings(...sessions.map((s) => s.mappings));

    const redactFn: RedactDocumentFn = (text, items, style: MarkerStyle) => {
      if (style === 'pseudonym') {
        const edits = items
          .filter((it) => it.active)
          .sort((a, b) => a.start - b.start)
          .map((it) => ({ start: it.start, end: it.end, replacement: it.code }));
        const seen = new Set<string>();
        const mapping = items
          .filter((it) => it.active)
          .filter((it) => {
            if (seen.has(it.code)) return false;
            seen.add(it.code);
            return true;
          })
          .map((it) => ({ code: it.code, category: it.category, original: it.original }));
        return { edits, mapping };
      }
      return applyRedactions(text, items, style);
    };

    const { blob, manifest } = await buildArchive(
      sessions.map((s) => ({ doc: s.doc, items: s.items })),
      redactFn,
      { style: 'pseudonym', merged },
    );

    const zip = await JSZip.loadAsync(await readBlobBytes(blob));
    const names = Object.keys(zip.files).sort();
    expect(names).toContain('manifest.csv');
    expect(names).toContain(MERGED_MAPPING_NAME);
    expect(manifest).toHaveLength(4);
    expect(manifest[1].mapping).toBe('ticket.mapping (2).csv');

    const mdOut = await zip.file('ticket.sanitized.md')!.async('string');
    expect(mdOut).toContain('USER_01');
    const mergedEntries = parseMapping(
      await zip.file(MERGED_MAPPING_NAME)!.async('string'),
    ).entries;
    expect(restore(mdOut, mergedEntries).restoredText).toBe(mdDoc.text);
  });
});
