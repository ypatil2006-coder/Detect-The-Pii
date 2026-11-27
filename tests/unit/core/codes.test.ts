import { describe, expect, it } from 'vitest';
import {
  CodeBook,
  buildMarker,
  generateCode,
  parseMarkers,
} from '../../../src/core/codes';

describe('generateCode', () => {
  it('produces 1000 distinct 6-hex-char codes and tracks them in used', () => {
    const used = new Set<string>();
    const codes: string[] = [];
    for (let i = 0; i < 1000; i++) {
      codes.push(generateCode(used));
    }
    expect(codes).toHaveLength(1000);
    expect(new Set(codes).size).toBe(1000);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-f]{6}$/);
      expect(used.has(code)).toBe(true);
    }
    expect(used.size).toBe(1000);
  });
});

describe('buildMarker', () => {
  it('builds markers for short and long category names', () => {
    expect(buildMarker('EMAIL', 'a3f9c2')).toBe('[EMAIL:a3f9c2]');
    expect(buildMarker('CREDIT_CARD', '0f1e2d')).toBe('[CREDIT_CARD:0f1e2d]');
  });
});

describe('parseMarkers', () => {
  it('returns {category, code, start, end} for every marker in order', () => {
    const text = 'User [EMAIL:a3f9c2] paid with [CREDIT_CARD:0f1e2d].';
    const result = parseMarkers(text);
    expect(result).toHaveLength(2);

    expect(result[0].category).toBe('EMAIL');
    expect(result[0].code).toBe('a3f9c2');
    expect(text.slice(result[0].start, result[0].end)).toBe('[EMAIL:a3f9c2]');

    expect(result[1].category).toBe('CREDIT_CARD');
    expect(result[1].code).toBe('0f1e2d');
    expect(text.slice(result[1].start, result[1].end)).toBe('[CREDIT_CARD:0f1e2d]');
    expect(result[1].start).toBeGreaterThan(result[0].end);
  });

  it('returns [] for plain text, uppercase hex, short codes, empty category, or unclosed markers', () => {
    expect(parseMarkers('Plain log without markers.')).toEqual([]);
    expect(parseMarkers('[EMAIL:ABCDEF]')).toEqual([]);
    expect(parseMarkers('[EMAIL:abc]')).toEqual([]);
    expect(parseMarkers('[:abcdef]')).toEqual([]);
    expect(parseMarkers('[EMAIL:abcdef')).toEqual([]);
  });

  it('handles adjacent markers and nested-looking brackets safely', () => {
    const adjacent = '[EMAIL:abcdef][PAN:123abc]';
    const adjResult = parseMarkers(adjacent);
    expect(adjResult).toHaveLength(2);
    expect(adjResult[0].end).toBe(adjResult[1].start);

    const nested = '[EMAIL:[PAN:abcdef]]';
    const nestedResult = parseMarkers(nested);
    expect(nestedResult).toHaveLength(1);
    expect(nestedResult[0]).toMatchObject({ category: 'PAN', code: 'abcdef' });
  });
});

describe('CodeBook', () => {
  it('assigns deterministic codes per (category, value, head, tail) and seeds imported entries', () => {
    const book = new CodeBook();
    const c1 = book.codeFor('EMAIL', 'rahul@acme.com');
    const c2 = book.codeFor('EMAIL', 'rahul@acme.com');
    const c3 = book.codeFor('CUSTOM', 'rahul@acme.com');
    expect(c1).toBe(c2);
    expect(c1).not.toBe(c3);

    const warnings = book.seed([
      { code: 'aaaaaa', category: 'PAN', original: 'ABCPA1234F' },
      { code: 'bbbbbb', category: 'PAN', original: 'ABCPA1234F' },
    ]);
    expect(warnings).toHaveLength(1);
    expect(book.codeFor('PAN', 'ABCPA1234F')).toBe('aaaaaa');
  });
});
