import { describe, expect, it } from 'vitest';
import {
  birthYearSplit,
  ibanLength,
  isCardNumber,
  isValidDob,
  isValidEmail,
  isValidIpv4,
  isValidIpv6,
  isValidLuhn,
  isValidPan,
  isValidPhone,
  isValidSsn,
  isValidVerhoeff,
  normalizeEntityValue,
  phoneLength,
  phonePrefixLength,
} from '../../../src/core/validators';

describe('isValidLuhn', () => {
  it('accepts valid Visa and Mastercard numbers with spaces or hyphens', () => {
    expect(isValidLuhn('4111 1111 1111 1111')).toBe(true);
    expect(isValidLuhn('4111-1111-1111-1111')).toBe(true);
    expect(isValidLuhn('5500-0000-0000-0004')).toBe(true);
    expect(isValidLuhn('378282246310005')).toBe(true); // 15-digit Amex
  });

  it('rejects random 16-digit strings that fail Luhn', () => {
    expect(isValidLuhn('1234567890123456')).toBe(false);
    expect(isValidLuhn('4111111111111112')).toBe(false);
  });

  it('rejects out-of-range lengths, non-digits, and all-zero strings', () => {
    expect(isValidLuhn('411111111111')).toBe(false); // 12 digits
    expect(isValidLuhn('41111111111111111111')).toBe(false); // 20 digits
    expect(isValidLuhn('0000000000000000')).toBe(false);
    expect(isValidLuhn('4111-1111-1111-111A')).toBe(false);
  });
});

describe('isValidVerhoeff', () => {
  it('accepts Verhoeff-valid 12-digit Aadhaar numbers in compact, spaced, or hyphenated forms', () => {
    expect(isValidVerhoeff('234567890124')).toBe(true);
    expect(isValidVerhoeff('2345 6789 0124')).toBe(true);
    expect(isValidVerhoeff('4999-1122-3345')).toBe(true);
  });

  it('rejects invalid check digits, 0/1 prefixes, repeated digits, and wrong lengths', () => {
    expect(isValidVerhoeff('234567890123')).toBe(false); // corrupted check digit
    expect(isValidVerhoeff('123456789012')).toBe(false); // starts with 1
    expect(isValidVerhoeff('034567890124')).toBe(false); // starts with 0
    expect(isValidVerhoeff('999999999999')).toBe(false); // repeated identical digits
    expect(isValidVerhoeff('23456789012')).toBe(false); // 11 digits
  });
});

describe('isValidPan', () => {
  it('accepts uppercase PANs with valid 4th entity-type character', () => {
    expect(isValidPan('ABCPA1234F')).toBe(true);
    expect(isValidPan('AAACB9876K')).toBe(true);
    expect(isValidPan('BZZPT4321Z')).toBe(true);
  });

  it('rejects invalid 4th-char codes, lowercase, and malformed PANs', () => {
    expect(isValidPan('ABCZA1234F')).toBe(false); // Z not in PCHABGJLFT
    expect(isValidPan('ABCDE1234F')).toBe(false); // D not in PCHABGJLFT
    expect(isValidPan('abcpa1234f')).toBe(false); // lowercase
    expect(isValidPan('ABCP12345F')).toBe(false);
  });
});

describe('isValidIpv4', () => {
  it('accepts valid IPv4 addresses', () => {
    expect(isValidIpv4('192.168.1.1')).toBe(true);
    expect(isValidIpv4('0.0.0.0')).toBe(true);
    expect(isValidIpv4('255.255.255.255')).toBe(true);
  });

  it('rejects out-of-range octets, leading zeros, and malformed strings', () => {
    expect(isValidIpv4('999.168.1.1')).toBe(false);
    expect(isValidIpv4('256.1.1.1')).toBe(false);
    expect(isValidIpv4('01.2.3.4')).toBe(false);
    expect(isValidIpv4('1.2.3')).toBe(false);
    expect(isValidIpv4('v1.2.3.4')).toBe(false);
  });
});

describe('isValidIpv6', () => {
  it('accepts full and compressed IPv6 addresses', () => {
    expect(isValidIpv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    expect(isValidIpv6('fe80::1')).toBe(true);
    expect(isValidIpv6('::1')).toBe(true);
  });

  it('rejects timestamps, MAC addresses, and malformed colons', () => {
    expect(isValidIpv6('12:34:56')).toBe(false);
    expect(isValidIpv6('AA:BB:CC:DD:EE:FF')).toBe(false);
    expect(isValidIpv6('2001:::1')).toBe(false);
    expect(isValidIpv6('2001::1::2')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts standard RFC-practical emails', () => {
    expect(isValidEmail('rahul.sharma@acme.com')).toBe(true);
    expect(isValidEmail('user+tag99@sub.domain.co.in')).toBe(true);
  });

  it('rejects handles, version strings, and malformed addresses', () => {
    expect(isValidEmail('@acme.com')).toBe(false);
    expect(isValidEmail('user@localhost')).toBe(false);
    expect(isValidEmail('foo@1.2')).toBe(false);
    expect(isValidEmail('rahul..sharma@acme.com')).toBe(false);
  });
});

describe('isValidPhone', () => {
  it('accepts Indian and international phone formats', () => {
    expect(isValidPhone('+91 98765 43210')).toBe(true);
    expect(isValidPhone('09876543210')).toBe(true);
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('+1 (415) 555-2671')).toBe(true);
  });

  it('rejects random 10-digit timestamps/IDs, short numbers, and uniform digits', () => {
    expect(isValidPhone('2026112701')).toBe(false);
    expect(isValidPhone('123456789')).toBe(false);
    expect(isValidPhone('9999999999')).toBe(false);
    expect(isValidPhone('1234567890')).toBe(false);
  });
});

describe('normalizeEntityValue', () => {
  it('normalizes format variants deterministically by type', () => {
    expect(normalizeEntityValue('EMAIL', '  Rahul@Acme.COM ')).toBe('rahul@acme.com');
    expect(normalizeEntityValue('CREDIT_CARD', '4111-1111-1111-1111')).toBe('4111111111111111');
    expect(normalizeEntityValue('CREDIT_CARD', '4111 1111 1111 1111')).toBe('4111111111111111');
    expect(normalizeEntityValue('AADHAAR', '2345 6789 0124')).toBe('234567890124');
    expect(normalizeEntityValue('AADHAAR', '2345-6789-0124')).toBe('234567890124');
    expect(normalizeEntityValue('PHONE', '+91 98765 43210')).toBe('+919876543210');
    expect(normalizeEntityValue('PHONE', '09876543210')).toBe('+919876543210');
    expect(normalizeEntityValue('PHONE', '9876543210')).toBe('+919876543210');
    expect(normalizeEntityValue('PAN', 'abcpa1234f')).toBe('ABCPA1234F');
    expect(normalizeEntityValue('IP', 'FE80::1')).toBe('fe80::1');
  });
});

describe('extended validators (phoneLength, cards, SSN, IBAN, IPv6, DOB)', () => {
  it('accepts US dashed/dotted phones and drops trailing non-phone digits via phoneLength', () => {
    expect(isValidPhone('415-867-5309')).toBe(true);
    expect(isValidPhone('415.867.5309')).toBe(true);
    expect(isValidPhone('(416) 967-1111')).toBe(true);
    expect(isValidPhone('+44 20 7946 0958')).toBe(true);
    expect(isValidPhone('+1 555 555 0100')).toBe(false);
    expect(isValidPhone('123-456-7890')).toBe(false);

    expect(phoneLength('+44 20 7946 0958 2026')).toBe('+44 20 7946 0958'.length);
    expect(phoneLength('+1 415 555 0192 2026')).toBe('+1 415 555 0192'.length);
    expect(phonePrefixLength('+44 20 7946 0958')).toBe(4);
    expect(phonePrefixLength('(415) 867-5309')).toBe(6);
  });

  it('validates card issuer prefixes and standard groupings', () => {
    expect(isCardNumber('4242 4242 4242 4242')).toBe(true);
    expect(isCardNumber('3782 822463 10005')).toBe(true);
    expect(isCardNumber('6011111111111117')).toBe(true);
    expect(isCardNumber('3530111333300000')).toBe(true);
    expect(isCardNumber('42 4242 4242 424242')).toBe(false);
    expect(isCardNumber('1000000000000008')).toBe(false);
  });

  it('validates US SSN issued ranges', () => {
    expect(isValidSsn('123-45-6789')).toBe(true);
    expect(isValidSsn('219 09 9999')).toBe(true);
    expect(isValidSsn('078051121')).toBe(true);
    expect(isValidSsn('000-12-3456')).toBe(false);
    expect(isValidSsn('666-12-3456')).toBe(false);
    expect(isValidSsn('912-34-5678')).toBe(false);
    expect(isValidSsn('123-00-4567')).toBe(false);
    expect(isValidSsn('123-45-0000')).toBe(false);
  });

  it('validates IBAN mod-97 checksum and country-specific lengths', () => {
    expect(ibanLength('GB82 WEST 1234 5698 7654 32 SORT CODE')).toBe(
      'GB82 WEST 1234 5698 7654 32'.length,
    );
    expect(ibanLength('DE89370400440532013000')).toBe(22);
    expect(ibanLength('FR14 2004 1010 0505 0001 3M02 606')).toBe(33);
    expect(ibanLength('GB83 WEST 1234 5698 7654 32')).toBe(false);
  });

  it('validates compressed IPv6 edge forms and rejects MAC/time', () => {
    expect(isValidIpv6('2001:db8::')).toBe(true);
    expect(isValidIpv6('fe80::1ff:fe23:4567:890a')).toBe(true);
    expect(isValidIpv6('12:30:45')).toBe(false);
    expect(isValidIpv6('00:1A:2B:3C:4D:5E')).toBe(false);
  });

  it('validates DOB formats and computes birthYearSplit', () => {
    expect(isValidDob('1985-03-14')).toBe(true);
    expect(isValidDob('03/14/1985')).toBe(true);
    expect(isValidDob('March 14, 1985')).toBe(true);
    expect(isValidDob('14 March 1985')).toBe(true);
    expect(isValidDob('Sept. 3, 1990')).toBe(true);
    expect(isValidDob('2026-13-40')).toBe(false);
    expect(birthYearSplit('1985-03-14')).toEqual({ head: 5, tail: 0 });
    expect(birthYearSplit('14 March 1985')).toEqual({ head: 0, tail: 5 });
  });
});
