import { describe, expect, it } from 'vitest';
import { maskDisplay } from '../../../src/core/mask';
import type { Category } from '../../../src/core/types';

describe('maskDisplay', () => {
  it('masks core Indian and international PII categories with verification context', () => {
    expect(maskDisplay('EMAIL', 'rahul.sharma@example.com')).toBe('r***@example.com');
    expect(maskDisplay('EMAIL', 'a@b.co')).toBe('a***@b.co');
    expect(maskDisplay('PHONE', '+91 98765 43210')).toBe('+91-XXXXXX3210');
    expect(maskDisplay('IP', '192.168.10.25')).toBe('192.168.***.***');
    expect(maskDisplay('PAN', 'ABCPA1234F')).toBe('AB***1234F');
    expect(maskDisplay('AADHAAR', '2345 6789 0124')).toBe('XXXX-XXXX-0124');
    expect(maskDisplay('CREDIT_CARD', '4111-1111-1111-1111')).toBe('XXXX-XXXX-XXXX-1111');
  });

  it('masks extended categories (SSN, IBAN, DOB, CUSTOM) and short values safely', () => {
    expect(maskDisplay('SSN', '123-45-6789')).toBe('***-**-6789');
    expect(maskDisplay('IBAN', 'GB82 WEST 1234 5698 7654 32')).toMatch(/^GB\*+32$/);
    expect(maskDisplay('DOB', '1985-03-14')).toBe('1985-**-**');
    expect(maskDisplay('CUSTOM', 'EMP-004521')).toBe('EMP*******');
    expect(maskDisplay('CUSTOM', 'AB')).toBe('**');
  });

  it.each<{ category: Category; original: string }>([
    { category: 'EMAIL', original: 'rahul@acme.com' },
    { category: 'PHONE', original: '+91 98765 43210' },
    { category: 'IP', original: '192.168.1.1' },
    { category: 'PAN', original: 'ABCPA1234F' },
    { category: 'AADHAAR', original: '2345 6789 0124' },
    { category: 'CREDIT_CARD', original: '4111-1111-1111-1111' },
    { category: 'SSN', original: '123-45-6789' },
    { category: 'IBAN', original: 'DE89370400440532013000' },
    { category: 'DOB', original: '1985-03-14' },
    { category: 'CUSTOM', original: 'X' },
  ])('masks $category without leaking original and never returns empty', ({ category, original }) => {
    const masked = maskDisplay(category, original);
    expect(masked).not.toBe(original);
    expect(masked.length).toBeGreaterThan(0);
  });
});
