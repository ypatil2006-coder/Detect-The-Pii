/**
 * Security & ReDoS guard tests.
 *
 * Verifies that the detection engine:
 *  1. Runs in linear time on adversarial inputs (ReDoS safety).
 *  2. Handles XSS payloads without throwing or producing unsafe output.
 *  3. Produces no false positives on common non-PII patterns.
 *  4. Handles oversized inputs without crashing.
 *  5. Luhn boundary conditions.
 */
import { describe, expect, it } from 'vitest';
import { detectPii } from '../../../src/core/detector';
import { sanitizeText } from '../../../src/core/redactor';
import { isValidLuhn } from '../../../src/core/validators';

const TIMEOUT_MS = 500; // Any scan > 500 ms on these inputs signals a ReDoS risk

describe('ReDoS safety — adversarial regex inputs', () => {
  it('scans a 10 000-character all-digit string in linear time', () => {
    const input = '1'.repeat(10_000);
    const start = performance.now();
    const { matches } = detectPii(input);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(TIMEOUT_MS);
    expect(matches).toBeDefined();
  });

  it('scans a 5 000-character mixed-symbol string without backtracking', () => {
    const input = ('a@b.' + '!'.repeat(50)).repeat(100);
    const start = performance.now();
    const { matches } = detectPii(input);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(TIMEOUT_MS);
    expect(matches).toBeDefined();
  });

  it('scans a 5 000-character invalid-IPv4 string without catastrophic backtracking', () => {
    const input = '999.999.999.999 '.repeat(312);
    const start = performance.now();
    const result = sanitizeText(input, 'full');
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(TIMEOUT_MS);
    // All candidates should be rejected (invalid octets)
    expect(result.stats.byType.IP).toBe(0);
  });
});

describe('XSS safety — injection payloads produce no script execution surface', () => {
  it('passes through <script> tags as literal text without redacting or throwing', () => {
    const payload = '<script>alert("xss")</script>';
    const result = sanitizeText(payload, 'full');
    // No PII — sanitized output equals original
    expect(result.sanitized).toBe(payload);
    expect(result.stats.total).toBe(0);
  });

  it('passes through HTML event attributes as literal text, only redacts real PII', () => {
    const payload = '<img src=x onerror=alert(1)> user@example.com';
    const result = sanitizeText(payload, 'full');
    // Email is redacted; HTML fragment stays as literal text
    expect(result.sanitized).not.toContain('user@example.com');
    expect(result.sanitized).toContain('<img src=x onerror=alert(1)>');
  });

  it('handles null bytes and control characters without throwing', () => {
    const payload = 'test\u0000\u0001\u001Fuser@test.com\u007F';
    expect(() => sanitizeText(payload, 'full')).not.toThrow();
  });
});

describe('Non-PII false positive guard', () => {
  it('does not flag out-of-range IPv4 octets (e.g. 999.999.1.1) as IP', () => {
    const result = sanitizeText('Invalid IPs: 999.999.1.1 and 256.0.0.1', 'full');
    expect(result.stats.byType.IP).toBe(0);
  });

  it('does not flag non-Luhn 16-digit order/tracking IDs as credit cards', () => {
    // 1234567890123456 fails Luhn
    const result = sanitizeText('Order ID: 1234567890123456', 'full');
    expect(result.stats.byType.CREDIT_CARD).toBe(0);
  });

  it('does not flag uniform repeated digits as Aadhaar', () => {
    const result = sanitizeText('Reference: 1111 1111 1111', 'full');
    expect(result.stats.byType.AADHAAR).toBe(0);
  });

  it('does not flag numeric timestamps as phone numbers', () => {
    const result = sanitizeText('Unix timestamp: 1700000000000', 'full');
    expect(result.stats.byType.PHONE).toBe(0);
  });
});

describe('Luhn boundary conditions', () => {
  it('accepts a 15-digit Luhn-valid Amex card number', () => {
    // 378282246310005 — standard Amex test number, Luhn valid
    expect(isValidLuhn('378282246310005')).toBe(true);
  });

  it('rejects all-zero strings', () => {
    expect(isValidLuhn('0000000000000000')).toBe(false);
  });

  it('rejects strings shorter than 13 digits', () => {
    expect(isValidLuhn('411111111111')).toBe(false);
  });

  it('rejects strings longer than 19 digits', () => {
    expect(isValidLuhn('12345678901234567890')).toBe(false);
  });

  it('accepts valid card with hyphen separators', () => {
    // 4111-1111-1111-1111 — Luhn valid Visa
    expect(isValidLuhn('4111-1111-1111-1111')).toBe(true);
  });
});

describe('Oversized input resilience', () => {
  it('handles a 100 000-character document without throwing', () => {
    const bigDoc = 'The user john@example.com called at +91 9876543210. '.repeat(2000);
    expect(() => sanitizeText(bigDoc, 'full')).not.toThrow();
  });

  it('detects multiple distinct emails correctly in a large document', () => {
    const bigDoc = 'alice@corp.com and bob@corp.com '.repeat(100);
    const result = sanitizeText(bigDoc, 'full');
    expect(result.stats.byType.EMAIL).toBeGreaterThan(0);
  });
});
