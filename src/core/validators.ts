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
      (leftRaw.startsWith(':') || leftRaw.endsWith(':')) ||
      (rightRaw.startsWith(':') || rightRaw.endsWith(':'))
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

/** Validates Indian (`+91`, `0`-prefixed, 10-digit `6–9XXXXXXXX`) and international phone formats. */
export function isValidPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || !PHONE_CHARS_REGEX.test(trimmed)) {
    return false;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15 || UNIFORM_DIGITS_REGEX.test(digits)) {
    return false;
  }

  if (trimmed.startsWith('+')) {
    if (digits.startsWith('0')) {
      return false;
    }
    if (digits.startsWith('91') && digits.length === 12) {
      return /^[6-9]/.test(digits.slice(2));
    }
    return true;
  }

  // Indian 0-prefixed 11-digit or 10-digit mobile (6-9 start)
  if (/^0[6-9]\d{9}$/.test(digits) || /^[6-9]\d{9}$/.test(digits)) {
    return true;
  }

  // Indian 91-prefixed without leading + when formatted with separator
  if (/^91[6-9]\d{9}$/.test(digits) && /[\s-]/.test(trimmed)) {
    return true;
  }

  // Formatted North American / international 10-digit (e.g. (415) 555-2671)
  if (digits.length === 10 && /[()]/.test(trimmed)) {
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits);
  }

  return false;
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
