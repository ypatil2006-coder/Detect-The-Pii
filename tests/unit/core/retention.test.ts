import { describe, expect, it } from 'vitest';
import { CodeBook } from '../../../src/core/codes';
import { addManualItem, detect, resplitItems } from '../../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../../src/core/patterns';
import { applyRedactions, outputFor, previewLabel } from '../../../src/core/redactor';
import { restore } from '../../../src/core/restorer';
import {
  checkRetention,
  describeRetention,
  firstExample,
  modesFor,
  sanitizeRetention,
  splitFor,
} from '../../../src/core/retention';
import type { Pattern, RedactionItem } from '../../../src/core/types';

const PREVIEW_PATTERNS: Pattern[] = BUILTIN_PATTERNS.map((p) => ({
  ...p,
  retention: { mode: 'preview' },
}));

describe('splitFor', () => {
  it('keeps leading/trailing characters and hides everything if nothing would remain hidden', () => {
    expect(splitFor('ABCPA1234F', { mode: 'ends', head: 2, tail: 0 })).toEqual({ head: 2, tail: 0 });
    expect(splitFor('9876543210', { mode: 'ends', head: 0, tail: 4 })).toEqual({ head: 0, tail: 4 });
    expect(splitFor('AB12', { mode: 'ends', head: 2, tail: 2 })).toEqual({ head: 0, tail: 0 });
    expect(splitFor('abc', { mode: 'delim', delimiter: '@', side: 'after' })).toEqual({ head: 0, tail: 0 });
    expect(splitFor('@x', { mode: 'delim', delimiter: '@', side: 'after' })).toEqual({ head: 0, tail: 0 });
  });

  it('uses first delimiter for "after" and last for "before"', () => {
    expect(splitFor('a@b@c.com', { mode: 'delim', delimiter: '@', side: 'after' })).toEqual({ head: 0, tail: 8 });
    expect(splitFor('a@b@c.com', { mode: 'delim', delimiter: '@', side: 'before' })).toEqual({ head: 4, tail: 0 });
  });
});

describe('checkRetention & helpers', () => {
  it('rejects non-hiding ends or empty delimiter and warns when exposing >= half', () => {
    expect(checkRetention('ABCPA1234F', { mode: 'ends', head: 10, tail: 0 }).error).toBeTruthy();
    expect(checkRetention('x', { mode: 'delim', delimiter: '', side: 'after' }).error).toBeTruthy();
    expect(checkRetention('ABCPA1234F', { mode: 'ends', head: 2, tail: 0 })).toEqual({ error: null, warnings: [] });
    expect(checkRetention('ABCPA1234F', { mode: 'ends', head: 6, tail: 0 }).warnings.length).toBe(1);
    expect(checkRetention('ABCPA1234F', { mode: 'ends', head: 2, tail: 2 }).warnings.length).toBe(1);
    expect(checkRetention('EMP-001', { mode: 'delim', delimiter: '@', side: 'after' }).warnings.length).toBe(1);
  });

  it('describes, lists modes, extracts first example, and sanitizes persisted objects', () => {
    expect(describeRetention({ mode: 'ends', head: 2, tail: 4 })).toContain('2');
    expect(describeRetention({ mode: 'delim', delimiter: '@', side: 'after' })).toContain('@');
    expect(modesFor('EMAIL')).toEqual(['none', 'ends', 'delim', 'preview']);
    expect(firstExample('rahul@acme.com, priya@acme.com')).toBe('rahul@acme.com');
    expect(sanitizeRetention({ mode: 'ends', head: -1, tail: 0 })).toBeNull();
    expect(sanitizeRetention({ mode: 'delim', delimiter: '@', side: 'after' })).toEqual({
      mode: 'delim',
      delimiter: '@',
      side: 'after',
    });
  });
});

describe('partial retention output & resplitItems', () => {
  it('keeps standard partial segments outside markers and restores exact original', () => {
    const text = 'PAN ABCPA1234F, email amy.chen@gmail.com, card 4242 4242 4242 4242';
    const book = new CodeBook();
    const items = detect(text, PREVIEW_PATTERNS, book);

    const pan = items.find((i) => i.category === 'PAN')!;
    const email = items.find((i) => i.category === 'EMAIL')!;
    const card = items.find((i) => i.category === 'CREDIT_CARD')!;

    expect(outputFor(pan, 'code')).toMatch(/^AB\[PAN:[0-9a-f]{6}\]$/);
    expect(outputFor(email, 'code')).toMatch(/^\[EMAIL:[0-9a-f]{6}\]@gmail\.com$/);
    expect(outputFor(card, 'code')).toMatch(/^\[CREDIT_CARD:[0-9a-f]{6}\]4242$/);
    expect(previewLabel(pan, 'code')).toBe('AB[PAN]');

    const { redactedText, mapping } = applyRedactions(text, items, 'code');
    expect(restore(redactedText, mapping).restoredText).toBe(text);

    resplitItems(items, book, () => undefined);
    const full = applyRedactions(text, items, 'code');
    expect(items.every((i) => !i.head && !i.tail)).toBe(true);
    expect(restore(full.redactedText, full.mapping).restoredText).toBe(text);
  });

  it('assigns distinct codes when identical text uses different retention', () => {
    const text = 'ABCPA1234F and ABCPA1234F';
    const book = new CodeBook();
    const items: RedactionItem[] = detect(text, PREVIEW_PATTERNS, book).slice(0, 1);
    const manual = addManualItem(items, text, 15, 25, 'PAN', book, { mode: 'none' });
    expect(manual.code).not.toBe(items[0].code);
    const { redactedText, mapping } = applyRedactions(text, items, 'code');
    expect(restore(redactedText, mapping).restoredText).toBe(text);
  });
});
