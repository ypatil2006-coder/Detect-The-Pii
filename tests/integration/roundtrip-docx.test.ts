import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { analyzeDocument, buildExportBlob } from '../../src/core/document-pipeline';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { restore } from '../../src/core/restorer';
import { parseMapping } from '../../src/formats/csv';
import { parseDocx } from '../../src/formats/docx';
import { buildSampleDocxFile } from '../../src/formats/samples';
import { readBlobBytes } from '../../src/formats/segments';

describe('DOCX roundtrip through document-pipeline', () => {
  it('sanitizes DOCX, leaves zero raw PII in XML, and restores back to original text', async () => {
    const file = await buildSampleDocxFile('audit.docx');
    const doc = await parseDocx(file);
    const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'pseudonym');

    expect(session.stats.rejectedCreditCards).toBe(1);
    expect(session.sanitizedText).not.toContain('rahul.sharma@acme.example');
    expect(session.sanitizedText).not.toContain('ABCPA1234F');
    expect(session.sanitizedText).not.toContain('4111-1111-1111-1111');
    expect(session.sanitizedText).toContain('1234-5678-9012-3456');

    const { sanitizedBlob, mappingCsv, fileName } = await buildExportBlob(session, 'pseudonym');
    expect(fileName).toBe('audit.sanitized-pseudonym.docx');

    const outBytes = await readBlobBytes(sanitizedBlob);
    const outZip = await JSZip.loadAsync(outBytes);
    const outXml = await outZip.file('word/document.xml')!.async('string');
    expect(outXml).not.toContain('rahul.sharma@acme.example');
    expect(outXml).not.toContain('ABCPA1234F');
    expect(outXml).not.toContain('4111-1111-1111-1111');

    const reloaded = await parseDocx(new File([outBytes as BlobPart], fileName));
    const parsedMap = parseMapping(mappingCsv);
    expect(parsedMap.errors).toEqual([]);
    const restored = restore(reloaded.text, parsedMap.entries);
    expect(restored.restoredText).toBe(doc.text);
  });
});
