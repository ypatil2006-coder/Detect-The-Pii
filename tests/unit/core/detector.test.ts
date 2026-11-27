import { describe, expect, it } from 'vitest';
import { CodeBook } from '../../../src/core/codes';
import {
  OverlapError,
  addManualItem,
  detect,
  detectPii,
  toggleItem,
} from '../../../src/core/detector';
import { applyEdits, applyRedactions } from '../../../src/core/redactor';
import type { Category, Pattern, RedactionItem } from '../../../src/core/types';

describe('detectPii', () => {
  it('detects all 6 PII types and tracks rejected Luhn/Verhoeff candidates', () => {
    const text = [
      'Contact: rahul@acme.com | Phone: +91 98765 43210',
      'Server IP: 192.168.10.25 | PAN: ABCPA1234F',
      'Aadhaar: 2345 6789 0124 | Invalid Aadhaar: 1234 5678 9012',
      'Card: 4111-1111-1111-1111 | Order ID: 1234-5678-9012-3456',
    ].join('\n');

    const { matches, stats } = detectPii(text);

    expect(matches.map((m) => m.type)).toEqual([
      'EMAIL',
      'PHONE',
      'IP',
      'PAN',
      'AADHAAR',
      'CREDIT_CARD',
    ]);
    expect(stats.total).toBe(6);
    expect(stats.byType).toEqual({
      EMAIL: 1,
      PHONE: 1,
      IP: 1,
      PAN: 1,
      AADHAAR: 1,
      CREDIT_CARD: 1,
    });
    expect(stats.rejectedCreditCards).toBe(1);
    expect(stats.rejectedAadhaar).toBeGreaterThanOrEqual(1);

    for (const match of matches) {
      expect(text.slice(match.start, match.end)).toBe(match.value);
    }
  });

  it('resolves overlapping patterns in favor of longest/most-specific entity', () => {
    const text = 'Accounts: user9876543210@mail.com and user_9876543210@mail.com';
    const { matches } = detectPii(text);

    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.type === 'EMAIL')).toBe(true);
  });

  it('ignores version strings, invalid IPv4 octets, timestamps, and MAC addresses', () => {
    const text =
      'Release v1.2.3.4 deployed at 12:34:56 from MAC AA:BB:CC:DD:EE:FF bad ip 999.168.1.1';
    const { matches, stats } = detectPii(text);

    expect(matches).toHaveLength(0);
    expect(stats.total).toBe(0);
  });

  it('detects IPv6 addresses alongside IPv4', () => {
    const text = 'Primary 10.0.0.1 backup fe80::1 gateway 2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const { matches } = detectPii(text);

    expect(matches.map((m) => m.type)).toEqual(['IP', 'IP', 'IP']);
    expect(matches.map((m) => m.value)).toEqual([
      '10.0.0.1',
      'fe80::1',
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
    ]);
  });

  it('scans 50KB of adversarial digit/space/punctuation noise in under 50ms', () => {
    const chunk = '1234 5678 9012 3456 - 999.888.777.666 :: 12:34:56 @@@ ';
    const adversarial = chunk.repeat(Math.ceil(50_000 / chunk.length)).slice(0, 50_000);

    const start = performance.now();
    const { matches } = detectPii(adversarial);
    const elapsedMs = performance.now() - start;

    expect(matches).toHaveLength(0);
    expect(elapsedMs).toBeLessThan(50);
  });

  it('detects US dashed/dotted phones and stops before trailing year/report numbers', () => {
    const text =
      'Phone +44 20 7946 0958 2026 annual report; US +1 415 555 0192 2026; dashed 415-867-5309 and dotted 415.867.5309';
    const { matches } = detectPii(text);

    expect(matches.map((m) => m.value)).toEqual([
      '+44 20 7946 0958',
      '+1 415 555 0192',
      '415-867-5309',
      '415.867.5309',
    ]);
  });
});

describe('detectPii Unicode, punctuation boundaries & Amex', () => {
  it('preserves exact UTF-16 offsets around emoji and CJK characters', () => {
    const text = '🔒 聯絡人 👤 rahul@acme.com | PAN ABCPA1234F 🎉';
    const { matches } = detectPii(text);

    expect(matches).toHaveLength(2);
    for (const m of matches) {
      expect(text.slice(m.start, m.end)).toBe(m.value);
    }
    expect(matches.map((m) => m.value)).toEqual(['rahul@acme.com', 'ABCPA1234F']);
  });

  it('strips trailing punctuation boundaries and detects 15-digit Amex cards', () => {
    const text = 'Contact (rahul@acme.com), IP 192.168.1.1. Amex 3782 822463 10005.';
    const { matches } = detectPii(text);

    expect(matches.map((m) => [m.type, m.value])).toEqual([
      ['EMAIL', 'rahul@acme.com'],
      ['IP', '192.168.1.1'],
      ['CREDIT_CARD', '3782 822463 10005'],
    ]);
  });
});

function mkPattern(opts: {
  id: string;
  regex: string;
  category?: Category;
  enabled?: boolean;
  validate?: (m: string) => boolean;
}): Pattern {
  return {
    id: opts.id,
    name: opts.id,
    category: opts.category ?? 'CUSTOM',
    source: 'custom',
    regex: opts.regex,
    example: 'x',
    enabled: opts.enabled ?? true,
    validate: opts.validate,
  };
}

describe('pattern detect, manual items & toggleItem', () => {
  it('resolves overlaps by longest span then earliest start, skipping disabled/zero-length rules', () => {
    const items = detect('xxABCDEFxx', [
      mkPattern({ id: 'short', regex: 'ABC' }),
      mkPattern({ id: 'long', regex: 'ABCDEF' }),
      mkPattern({ id: 'off', regex: 'ABCDEF', enabled: false }),
      mkPattern({ id: 'zero', regex: 'a*' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].original).toBe('ABCDEF');
    expect(items[0].origin).toBe('auto');

    const tie = detect('ABCXYZ', [
      mkPattern({ id: 'first', regex: 'ABCXY' }),
      mkPattern({ id: 'second', regex: 'BCXYZ' }),
    ]);
    expect(tie).toHaveLength(1);
    expect(tie[0].original).toBe('ABCXY');
  });

  it('supports manual items, OverlapError guards, and toggleItem reactivation checks', () => {
    const text = '0123456789';
    const items: RedactionItem[] = [];
    const book = new CodeBook();

    const a = addManualItem(items, text, 2, 6, 'PHONE', book);
    expect(a.origin).toBe('manual');
    expect(() => addManualItem(items, text, 4, 8, 'EMAIL', book)).toThrow(OverlapError);
    expect(() => addManualItem(items, text, -1, 2, 'EMAIL', book)).toThrow();
    expect(() => addManualItem(items, text, 5, 5, 'EMAIL', book)).toThrow();
    expect(() => addManualItem(items, text, 5, text.length + 1, 'EMAIL', book)).toThrow();

    toggleItem(items, a.id);
    expect(a.active).toBe(false);
    const b = addManualItem(items, text, 4, 8, 'EMAIL', book);
    expect(b.active).toBe(true);
    expect(() => toggleItem(items, a.id)).toThrow(OverlapError);
    expect(a.active).toBe(false);
    expect(toggleItem(items, 'missing')).toBeUndefined();
  });

  it('throws on overlapping TextEdits in applyEdits and orders mapping by first occurrence', () => {
    const items = detect('BBB AAA BBB', [mkPattern({ id: 'w', regex: '[A-Z]{3}' })]);
    const res = applyRedactions('BBB AAA BBB', items, 'code');
    expect(res.mapping.map((m) => m.original)).toEqual(['BBB', 'AAA']);

    expect(() =>
      applyEdits('abcdef', [
        { start: 0, end: 4, replacement: 'X' },
        { start: 2, end: 5, replacement: 'Y' },
      ]),
    ).toThrow();
  });
});
