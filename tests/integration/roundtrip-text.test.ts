import { describe, expect, it } from 'vitest';
import {
  analyzeDocument,
  buildExportBlob,
  recomputeDocumentSession,
} from '../../src/core/document-pipeline';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { restore } from '../../src/core/restorer';
import { parseMapping } from '../../src/formats/csv';
import { parsePlainText } from '../../src/formats/plaintext';
import { readBlobText } from '../../src/formats/segments';
import { MARKDOWN_SAMPLE_TEXT, getSampleById } from '../../src/formats/samples';

describe('TXT, MD, and CSV roundtrip through document-pipeline', () => {
  it('analyzes, exports, and restores TXT and Markdown documents in pseudonym mode', async () => {
    const txtContent = getSampleById('support-log').content;
    const fixtures = [
      { name: 'support.txt', format: 'txt' as const, content: txtContent },
      { name: 'brief.md', format: 'md' as const, content: MARKDOWN_SAMPLE_TEXT },
    ];

    for (const fx of fixtures) {
      const doc = await parsePlainText(new File([fx.content], fx.name), fx.format);
      const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'pseudonym');

      expect(session.items.length).toBeGreaterThanOrEqual(5);
      expect(session.stats.rejectedCreditCards).toBe(1);
      expect(session.stages).toHaveLength(7);
      expect(session.sanitizedText).not.toContain('rahul.sharma@acme.example');
      expect(session.sanitizedText).not.toContain('4111-1111-1111-1111');
      expect(session.sanitizedText).toContain('1234-5678-9012-3456');
      expect(session.sanitizedText).toContain('USER_01');

      const exported = await buildExportBlob(session, 'pseudonym');
      const exportedText = await readBlobText(exported.sanitizedBlob);
      expect(exportedText).toBe(session.sanitizedText);

      const parsedMap = parseMapping(exported.mappingCsv);
      expect(parsedMap.errors).toEqual([]);
      const restored = restore(exportedText, parsedMap.entries);
      expect(restored.missingCodes).toEqual([]);
      expect(restored.restoredText).toBe(fx.content);
    }
  });

  it('supports interactive item toggling and recomputeDocumentSession across all 5 marker styles', async () => {
    const text = 'Contact rahul@acme.com and PAN ABCPA1234F.';
    const doc = await parsePlainText(new File([text], 'note.txt'), 'txt');
    const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'full');
    expect(session.sanitizedText).toBe('Contact [REDACTED] and PAN [REDACTED].');

    // Toggle off PAN item so it stays visible
    const toggled = session.items.map((it) =>
      it.category === 'PAN' ? { ...it, active: false } : it,
    );
    const recomputed = recomputeDocumentSession(doc, toggled, 'partial');
    expect(recomputed.sanitizedText).toBe('Contact r***@acme.com and PAN ABCPA1234F.');
    expect(recomputed.stats.total).toBe(1);

    const catSession = recomputeDocumentSession(doc, session.items, 'category');
    expect(catSession.sanitizedText).toBe('Contact [EMAIL] and PAN [PAN].');

    const blankSession = recomputeDocumentSession(doc, session.items, 'blank');
    expect(blankSession.sanitizedText).toContain('@');
    expect(blankSession.sanitizedText).not.toContain('rahul');
    expect(blankSession.sanitizedText).not.toContain('ABCPA1234F');
  });

  it('handles CSV LoadedDocument with quoted commas and BOM-clean diffRows', async () => {
    const csv = '\uFEFF' + getSampleById('customers-csv').content;
    const doc = await parsePlainText(new File([csv], 'customers.csv'), 'csv');
    const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'pseudonym');

    expect(session.diffRows[0].hasChanges).toBe(false);
    expect(session.sanitizedText).toContain('"Sharma, Rahul",USER_01,');
    expect(session.sanitizedText).toContain('1234567890123456');
    expect(session.stats.rejectedCreditCards).toBe(1);
  });
});
