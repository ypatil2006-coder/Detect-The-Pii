import { describe, expect, it } from 'vitest';
import { detectPii } from '../../../src/core/detector';

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
});
