import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import type { PiiType } from './types';

/**
 * Validates a credit card candidate (13–19 digits, spaces/hyphens allowed)
 * using the Luhn mod-10 checksum algorithm.
 */
export function isValidLuhn(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits) || /^0+$/.test(digits)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/** Issuer prefixes: Visa, Mastercard, American Express, Discover, JCB, UnionPay, Diners Club. */
const CARD_PREFIX_REGEX =
  /^(?:4|5[1-5]|2(?:2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)|3[47]|6011|65|64[4-9]|35(?:2[89]|[3-8]\d)|62|30[0-5]|36|38)/;
const CARD_GROUPS = new Set([
  '4-4-4-4',
  '4-4-4-4-3',
  '4-6-5',
  '4-6-4',
  '4-4-4-1',
  '4-4-4-2',
  '4-4-4-3',
]);

/**
 * Validates payment card candidates using issuer prefix, standard grouping, and Luhn checksum.
 */
export function isCardNumber(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  if (!CARD_PREFIX_REGEX.test(digits) || !isValidLuhn(match)) {
    return false;
  }
  const groups = match.split(/[\s-]/);
  return (
    groups.length === 1 ||
    (new Set(match.match(/[\s-]/g)).size === 1 &&
      CARD_GROUPS.has(groups.map((g) => g.length).join('-')))
  );
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

/**
 * Validates a 12-digit Indian Aadhaar candidate (starting with 2–9, non-uniform digits)
 * using the Verhoeff checksum algorithm.
 */
export function isValidVerhoeff(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^[2-9]\d{11}$/.test(digits) || /^(\d)\1{11}$/.test(digits)) {
    return false;
  }

  let checksum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(digits.length - 1 - i) - 48;
    checksum = VERHOEFF_D[checksum][VERHOEFF_P[i % 8][digit]];
  }

  return checksum === 0;
}

const PAN_REGEX = /^[A-Z]{3}[PCHABGJLFT][A-Z][0-9]{4}[A-Z]$/;

/**
 * Validates an Indian Permanent Account Number (PAN): `[A-Z]{5}[0-9]{4}[A-Z]`
 * with valid 4th-character entity code (`P, C, H, A, B, G, J, L, F, T`).
 */
export function isValidPan(raw: string): boolean {
  return PAN_REGEX.test(raw.trim());
}

const IPV4_OCTET_REGEX = /^(?:0|[1-9]\d{0,2})$/;

/** Validates a dotted-quad IPv4 address with octets in 0–255 and no leading zeros. */
export function isValidIpv4(raw: string): boolean {
  const parts = raw.trim().split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!IPV4_OCTET_REGEX.test(part)) {
      return false;
    }
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

const IPV6_HEXTET_REGEX = /^[0-9a-fA-F]{1,4}$/;

/** Validates standard and `::`-compressed IPv6 addresses while rejecting times and MACs. */
export function isValidIpv6(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes(':::') || /[^0-9a-fA-F:]/.test(trimmed)) {
    return false;
  }

  const compressionParts = trimmed.split('::');
  if (compressionParts.length > 2) {
    return false;
  }

  if (compressionParts.length === 2) {
    const [leftRaw, rightRaw] = compressionParts;
    if (
      leftRaw.startsWith(':') ||
      leftRaw.endsWith(':') ||
      rightRaw.startsWith(':') ||
      rightRaw.endsWith(':')
    ) {
      return false;
    }
    const left = leftRaw ? leftRaw.split(':') : [];
    const right = rightRaw ? rightRaw.split(':') : [];
    const totalGroups = left.length + right.length;
    if (totalGroups < 1 || totalGroups > 7) {
      return false;
    }
    return [...left, ...right].every((g) => IPV6_HEXTET_REGEX.test(g));
  }

  if (trimmed.startsWith(':') || trimmed.endsWith(':')) {
    return false;
  }
  const groups = trimmed.split(':');
  return groups.length === 8 && groups.every((g) => IPV6_HEXTET_REGEX.test(g));
}

const EMAIL_LOCAL_REGEX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_LABEL_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const EMAIL_TLD_REGEX = /^[A-Za-z]{2,}$/;

/** Validates an email address without backtracking-prone regexes. */
export function isValidEmail(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 254 || /\s/.test(trimmed)) {
    return false;
  }

  const parts = trimmed.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !EMAIL_LOCAL_REGEX.test(local)
  ) {
    return false;
  }

  if (!domain || domain.length > 253 || !domain.includes('.')) {
    return false;
  }

  const labels = domain.split('.');
  if (labels.length < 2) {
    return false;
  }

  const tld = labels[labels.length - 1];
  return (
    EMAIL_TLD_REGEX.test(tld) &&
    labels.every((label) => EMAIL_LABEL_REGEX.test(label))
  );
}

const PHONE_CHARS_REGEX = /^\+?[\d\s().-]+$/;
const UNIFORM_DIGITS_REGEX = /^(\d)\1+$/;
const NANP_FORMATTED_REGEX = /^(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}$/;

function isSingleValidPhone(candidate: string): boolean {
  if (!candidate || !PHONE_CHARS_REGEX.test(candidate)) {
    return false;
  }
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15 || UNIFORM_DIGITS_REGEX.test(digits)) {
    return false;
  }
  if (candidate.startsWith('+')) {
    if (digits.startsWith('0')) {
      return false;
    }
    return isValidPhoneNumber(candidate);
  }
  if (/^0[6-9]\d{9}$/.test(digits) || /^[6-9]\d{9}$/.test(digits)) {
    return !candidate.includes('.');
  }
  if (/^91[6-9]\d{9}$/.test(digits) && /[\s-]/.test(candidate)) {
    return !candidate.includes('.');
  }
  if (NANP_FORMATTED_REGEX.test(candidate)) {
    return isValidPhoneNumber(candidate, { defaultCallingCode: '1' });
  }
  return false;
}

/**
 * Returns the longest valid phone number length at the start of `match`,
 * dropping trailing digit groups (e.g. a year) that ran on after a valid phone.
 */
export function phoneLength(match: string): number | false {
  const groups = match.split(/(?<=\d|\))(?=[\s.-])/);
  for (let n = groups.length; n >= 1; n--) {
    const candidate = groups.slice(0, n).join('');
    if (isSingleValidPhone(candidate)) {
      return candidate.length;
    }
  }
  return false;
}

/** Returns the character length of a phone number's country code or North American area code. */
export function phonePrefixLength(value: string): number {
  if (value.startsWith('+')) {
    const code = parsePhoneNumberFromString(value)?.countryCallingCode;
    return code ? (value.match(new RegExp(`^\\+\\s*${code}[\\s.-]?`))?.[0].length ?? 0) : 0;
  }
  return value.match(/^(?:\(\d{3}\)\s?|\d{3}[\s.-])/)?.[0].length ?? 0;
}

/** Validates Indian (`+91`, `0`-prefixed, 10-digit `6–9XXXXXXXX`) and international phone formats. */
export function isValidPhone(raw: string): boolean {
  const trimmed = raw.trim();
  return Boolean(trimmed) && phoneLength(trimmed) === trimmed.length;
}

/** Validates a US Social Security Number in issued ranges (excludes 000, 666, 9xx, 00, 0000). */
export function isValidSsn(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  return (
    digits.length === 9 &&
    !/^(?:000|666|9)/.test(digits) &&
    digits.slice(3, 5) !== '00' &&
    digits.slice(5) !== '0000'
  );
}

/** IBAN lengths per country (ISO 13616); others accepted at 15–34 characters. */
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CR: 22,
  CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24,
  ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25,
  QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26, UA: 29,
  VG: 24, XK: 20,
};

function mod97(iban: string): number {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) {
      rest = (rest * 10 + Number(d)) % 97;
    }
  }
  return rest;
}

/** Returns the accepted prefix length of an IBAN matching its country length and mod-97 check. */
export function ibanLength(match: string): number | false {
  const want = IBAN_LENGTH[match.slice(0, 2)];
  let chars = 0;
  let end = 0;
  for (; end < match.length && (want === undefined || chars < want); end++) {
    if (match[end] !== ' ') {
      chars++;
    }
  }
  const iban = match.slice(0, end).replace(/ /g, '');
  if (want !== undefined ? iban.length !== want : iban.length < 15 || iban.length > 34) {
    return false;
  }
  return mod97(iban) === 1 ? end : false;
}

/** Validates an entire IBAN string via country length and ISO 7064 mod-97 check. */
export function isValidIban(match: string): boolean {
  const trimmed = match.trim();
  return Boolean(trimmed) && ibanLength(trimmed) === trimmed.length;
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** Validates a date of birth string (ISO, slash/dot, or English month-name formats). */
export function isValidDob(match: string): boolean {
  const word = match.match(/[A-Za-z]{3,}/)?.[0];
  const numbers = (match.match(/\d+/g) ?? []).map(Number);
  let month = 0;
  let day = 0;

  if (word) {
    month = MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
    day = numbers.find((n) => n <= 31) ?? 0;
  } else if (/^\d{4}/.test(match)) {
    month = numbers[1] ?? 0;
    day = numbers[2] ?? 0;
  } else {
    const [a = 0, b = 0] = numbers;
    [month, day] = a <= 12 ? [a, b] : [b, a];
  }
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Splits a date-of-birth string to keep only its 4-digit birth year and adjacent separator. */
export function birthYearSplit(value: string): { head: number; tail: number } {
  const head = value.match(/^\d{4}[-/.]\s*/)?.[0];
  if (head) {
    return { head: head.length, tail: 0 };
  }
  const tail = value.match(/[\s,/.-]+\d{4}$/)?.[0];
  return tail ? { head: 0, tail: tail.length } : { head: 0, tail: 0 };
}

/** Normalizes entity variants so identical PII maps to one pseudonym across formats. */
export function normalizeEntityValue(type: PiiType, raw: string): string {
  const trimmed = raw.trim();
  switch (type) {
    case 'EMAIL':
    case 'IP':
      return trimmed.toLowerCase();
    case 'PAN':
      return trimmed.toUpperCase();
    case 'CREDIT_CARD':
    case 'AADHAAR':
      return trimmed.replace(/\D/g, '');
    case 'PHONE': {
      const digits = trimmed.replace(/\D/g, '');
      if (/^[6-9]\d{9}$/.test(digits)) {
        return `+91${digits}`;
      }
      if (/^0[6-9]\d{9}$/.test(digits)) {
        return `+91${digits.slice(1)}`;
      }
      if (/^91[6-9]\d{9}$/.test(digits)) {
        return `+${digits}`;
      }
      return trimmed.startsWith('+') ? `+${digits}` : digits;
    }
  }
}
