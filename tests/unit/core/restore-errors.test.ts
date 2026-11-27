import { describe, expect, it } from 'vitest';
import { CodeBook, parseMarkers } from '../../../src/core/codes';
import { detect, toggleItem } from '../../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../../src/core/patterns';
import { applyRedactions, mergeMappings } from '../../../src/core/redactor';
import { restore } from '../../../src/core/restorer';

describe('restore & mapping error handling', () => {
  it('reports missing codes, keeps unmapped markers verbatim, and restores all other markers', () => {
    const original = 'Contact rahul@acme.com | PAN ABCPA1234F | IP 192.168.1.10';
    const items = detect(original, BUILTIN_PATTERNS);
    const { redactedText, mapping } = applyRedactions(original, items, 'code');
    expect(mapping).toHaveLength(3);

    const dropped = mapping[0];
    const remaining = mapping.slice(1);
    const result = restore(redactedText, remaining);

    expect(result.missingCodes).toEqual([dropped.code]);
    expect(result.restoredCount).toBe(2);
    expect(result.restoredText).toContain(`[${dropped.category}:${dropped.code}]`);
    for (const entry of remaining) {
      expect(result.restoredText).toContain(entry.original);
    }
  });

  it('leaves marker-like text unchanged and reports missing code when mapping is empty', () => {
    const text = 'See clause [EMAIL:abcdef] for details.';
    const result = restore(text, []);
    expect(result.restoredText).toBe(text);
    expect(result.missingCodes).toEqual(['abcdef']);
    expect(result.restoredCount).toBe(0);
  });

  it('restores a marker by code alone even when mapping category differs', () => {
    const text = 'User [EMAIL:abcdef] signed in.';
    const result = restore(text, [
      { code: 'abcdef', category: 'CUSTOM', original: 'rahul@acme.com' },
    ]);
    expect(result.restoredText).toBe('User rahul@acme.com signed in.');
    expect(result.missingCodes).toEqual([]);
    expect(result.restoredCount).toBe(1);
  });

  it('round-trips documents with toggled-off items and merges batch mappings without duplicates', () => {
    const doc1 = 'User rahul@acme.com and PAN ABCPA1234F and IP 10.0.0.1';
    const doc2 = 'User rahul@acme.com and Aadhaar 2345 6789 0124';
    const book = new CodeBook();

    const items1 = detect(doc1, BUILTIN_PATTERNS, book);
    toggleItem(items1, items1[2].id); // leave IP active=false
    const red1 = applyRedactions(doc1, items1, 'code');

    expect(red1.redactedText).toContain('10.0.0.1');
    expect(red1.mapping.some((m) => m.original === '10.0.0.1')).toBe(false);

    const items2 = detect(doc2, BUILTIN_PATTERNS, book);
    const red2 = applyRedactions(doc2, items2, 'code');

    const merged = mergeMappings(red1.mapping, red2.mapping);
    expect(merged).toHaveLength(3); // rahul@acme.com shared once + PAN + Aadhaar
    expect(parseMarkers(red1.redactedText)[0].code).toBe(
      parseMarkers(red2.redactedText)[0].code,
    );

    expect(restore(red1.redactedText, merged).restoredText).toBe(doc1);
    expect(restore(red2.redactedText, merged).restoredText).toBe(doc2);
  });
});
