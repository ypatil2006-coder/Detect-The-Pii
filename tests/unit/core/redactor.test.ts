import { describe, expect, it } from 'vitest';
import { createPseudonymState } from '../../../src/core/types';
import { formatPartialMask, sanitizeText } from '../../../src/core/redactor';

describe('formatPartialMask', () => {
  it('formats partial masks preserving verification context for all 6 PII types', () => {
    expect(formatPartialMask('CREDIT_CARD', '4111-1111-1111-1111')).toBe('XXXX-XXXX-XXXX-1111');
    expect(formatPartialMask('AADHAAR', '2345 6789 0124')).toBe('XXXX-XXXX-0124');
    expect(formatPartialMask('EMAIL', 'rahul@acme.com')).toBe('r***@acme.com');
    expect(formatPartialMask('PAN', 'ABCPA1234F')).toBe('AB***1234F');
    expect(formatPartialMask('IP', '192.168.10.25')).toBe('192.168.***.***');
    expect(formatPartialMask('PHONE', '+91 98765 43210')).toBe('+91-XXXXXX3210');
  });
});

describe('sanitizeText (full & partial)', () => {
  const sample = 'Email rahul@acme.com card 4111-1111-1111-1111 PAN ABCPA1234F';

  it('replaces all matches with [REDACTED] in full mode', () => {
    const res = sanitizeText(sample, 'full');

    expect(res.mode).toBe('full');
    expect(res.sanitized).toBe('Email [REDACTED] card [REDACTED] PAN [REDACTED]');
    expect(res.stats.total).toBe(3);
    expect(res.pseudonyms).toEqual([]);
  });

  it('retains partial verification context in partial mode', () => {
    const res = sanitizeText(sample, 'partial');

    expect(res.mode).toBe('partial');
    expect(res.sanitized).toBe(
      'Email r***@acme.com card XXXX-XXXX-XXXX-1111 PAN AB***1234F',
    );
  });
});

describe('sanitizeText (pseudonym mode)', () => {
  it('assigns consistent deterministic placeholders across lines and format variants', () => {
    const doc = [
      'Line 1: rahul@acme.com paid with 4111-1111-1111-1111 from 192.168.1.1',
      'Line 2: priya@acme.com called +91 98765 43210 PAN ABCPA1234F Aadhaar 2345 6789 0124',
      'Line 3: Rahul@Acme.com retried 4111 1111 1111 1111 via 9876543210',
    ].join('\n');

    const res = sanitizeText(doc, 'pseudonym');

    expect(res.sanitized).toBe(
      [
        'Line 1: USER_01 paid with CARD_01 from IP_01',
        'Line 2: USER_02 called PHONE_01 PAN PAN_01 Aadhaar AADHAAR_01',
        'Line 3: USER_01 retried CARD_01 via PHONE_01',
      ].join('\n'),
    );

    expect(res.pseudonyms).toEqual([
      {
        placeholder: 'USER_01',
        type: 'EMAIL',
        maskedPreview: 'r***@acme.com',
        count: 2,
      },
      {
        placeholder: 'CARD_01',
        type: 'CREDIT_CARD',
        maskedPreview: 'XXXX-XXXX-XXXX-1111',
        count: 2,
      },
      {
        placeholder: 'IP_01',
        type: 'IP',
        maskedPreview: '192.168.***.***',
        count: 1,
      },
      {
        placeholder: 'USER_02',
        type: 'EMAIL',
        maskedPreview: 'p***@acme.com',
        count: 1,
      },
      {
        placeholder: 'PHONE_01',
        type: 'PHONE',
        maskedPreview: '+91-XXXXXX3210',
        count: 2,
      },
      {
        placeholder: 'PAN_01',
        type: 'PAN',
        maskedPreview: 'AB***1234F',
        count: 1,
      },
      {
        placeholder: 'AADHAAR_01',
        type: 'AADHAAR',
        maskedPreview: 'XXXX-XXXX-0124',
        count: 1,
      },
    ]);
  });

  it('preserves pseudonym mappings across calls when sharing PseudonymState', () => {
    const state = createPseudonymState();
    const row1 = sanitizeText('Owner: rahul@acme.com', 'pseudonym', state);
    const row2 = sanitizeText('Reviewer: priya@acme.com, Backup: rahul@acme.com', 'pseudonym', state);

    expect(row1.sanitized).toBe('Owner: USER_01');
    expect(row2.sanitized).toBe('Reviewer: USER_02, Backup: USER_01');
  });
});
