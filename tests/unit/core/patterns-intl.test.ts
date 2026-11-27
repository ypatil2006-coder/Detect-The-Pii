import { describe, expect, it } from 'vitest';
import { CodeBook } from '../../../src/core/codes';
import { detect, resplitItems } from '../../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../../src/core/patterns';
import { outputFor } from '../../../src/core/redactor';
import type { Category } from '../../../src/core/types';

const of = (category: Category, text: string) =>
  detect(text, BUILTIN_PATTERNS)
    .filter((it) => it.category === category)
    .map((it) => it.original);

describe('BUILTIN_PATTERNS Indian + International rules', () => {
  it.each([
    '+1 (415) 867-5309',
    '(416) 967-1111',
    '415-867-5309',
    '415.867.5309',
    '+44 20 7946 0958',
    '+81 3-1234-5678',
    '+33 1 42 68 53 00',
    '+61 2 9374 4000',
    '+91 98765 43210',
    '9876543210',
  ])('detects valid phone %s', (phone) => {
    expect(of('PHONE', `Call ${phone} today.`)).toEqual([phone]);
  });

  it('rejects fictional numbers, dates, order numbers, and drops trailing year after phone', () => {
    expect(
      of('PHONE', 'Call 555-0123 or +1 555 555 0100. Shipped 2026-10-16, order 123-456-7890.'),
    ).toEqual([]);
    expect(of('PHONE', 'Phone +44 20 7946 0958 2026 annual report')).toEqual(['+44 20 7946 0958']);
  });

  it('detects Indian PAN and Verhoeff-valid Aadhaar while rejecting invalid ones', () => {
    expect(of('PAN', 'PAN ABCPA1234F invalid ABCZA1234F')).toEqual(['ABCPA1234F']);
    expect(of('AADHAAR', 'Aadhaar 2345 6789 0124 bad 1234 5678 9012')).toEqual(['2345 6789 0124']);
  });

  it('detects Luhn-valid issuer cards and rejects bad checksums/prefixes/groupings', () => {
    expect(
      of('CREDIT_CARD', 'Cards: 4242 4242 4242 4242, 3782 822463 10005, 6011111111111117'),
    ).toEqual(['4242 4242 4242 4242', '3782 822463 10005', '6011111111111117']);
    expect(
      of(
        'CREDIT_CARD',
        'Bad 4242 4242 4242 4241, 1234 5678 9012 3452, 42 4242 4242 424242, tracking 1000000000000008.',
      ),
    ).toEqual([]);
  });

  it('detects US SSNs, IBANs, IPv4/IPv6, and labelled DOBs while rejecting noise', () => {
    expect(of('SSN', 'SSN 123-45-6789; spouse 219 09 9999; SSN: 078051121.')).toEqual([
      '123-45-6789',
      '219 09 9999',
      '078051121',
    ]);
    expect(of('SSN', '000-12-3456 666-12-3456 912-34-5678 123-00-4567 123-45-0000')).toEqual([]);

    expect(of('IBAN', 'GB82 WEST 1234 5698 7654 32 SORT CODE')).toEqual([
      'GB82 WEST 1234 5698 7654 32',
    ]);
    expect(of('IBAN', 'GB83 WEST 1234 5698 7654 32')).toEqual([]);

    expect(
      of('IP', '192.168.1.10 and 2001:db8:: and v999.1.1.1 build 1.2.3.4.5 date 2026.10.16 at 12:30:45 MAC 00:1A:2B:3C:4D:5E'),
    ).toEqual(['192.168.1.10', '2001:db8::']);

    expect(of('DOB', 'DOB: 1985-03-14 | Born on 14 March 1985 | Invoice Date: 2026-10-16 | DOB: 2026-13-40')).toEqual([
      '1985-03-14',
      '14 March 1985',
    ]);
  });

  it('renders standard preview retention cleanly across categories', () => {
    const book = new CodeBook();
    const text = '4242 4242 4242 4242 / DOB: 1985-03-14 / +44 20 7946 0958 / GB82 WEST 1234 5698 7654 32 / 192.168.1.10 / 2001:db8::1 / 123-45-6789';
    const items = detect(text, BUILTIN_PATTERNS, book);
    resplitItems(items, book, () => ({ mode: 'preview' }));
    expect(items.map((it) => outputFor(it, 'label'))).toEqual([
      '[CREDIT_CARD]4242',
      '1985-[DOB]',
      '+44 [PHONE]',
      'GB[IBAN]',
      '192.168.[IP]',
      '2001:db8:[IP]',
      '[SSN]',
    ]);
  });
});
