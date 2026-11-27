import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { analyzeDocument, buildExportBlob } from '../../src/core/document-pipeline';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { restore } from '../../src/core/restorer';
import { parseMapping } from '../../src/formats/csv';
import { buildSampleXlsxFile } from '../../src/formats/samples';
import { readBlobBytes } from '../../src/formats/segments';
import { parseXlsx } from '../../src/formats/xlsx';

describe('XLSX roundtrip through document-pipeline', () => {
  it('sanitizes cells, leaves zero raw PII in any archive XML, and restores back to original', async () => {
    const file = await buildSampleXlsxFile('customers.xlsx');
    const doc = await parseXlsx(file);
    const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'pseudonym');

    expect(session.stats.rejectedCreditCards).toBe(1);
    expect(session.sanitizedText).toContain('1234567890123456');
    expect(session.sanitizedText).not.toContain('rahul.sharma@acme.example');
    expect(session.sanitizedText).not.toContain('4111-1111-1111-1111');

    const { sanitizedBlob, mappingCsv, fileName } = await buildExportBlob(session, 'pseudonym');
    expect(fileName).toBe('customers.sanitized-pseudonym.xlsx');

    const outBytes = await readBlobBytes(sanitizedBlob);
    const outZip = await JSZip.loadAsync(outBytes);
    for (const path of Object.keys(outZip.files)) {
      const entry = outZip.files[path];
      if (entry.dir) continue;
      const content = await entry.async('string');
      for (const item of session.items.filter((i) => i.active)) {
        expect(content, `${path} leaked ${item.original}`).not.toContain(item.original);
      }
    }

    const reloaded = await parseXlsx(new File([outBytes as BlobPart], fileName));
    const parsedMap = parseMapping(mappingCsv);
    expect(parsedMap.errors).toEqual([]);
    const restored = restore(reloaded.text, parsedMap.entries);
    expect(restored.missingCodes).toEqual([]);
    expect(restored.restoredText).toBe(doc.text);
  });
});
