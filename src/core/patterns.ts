import type { Pattern } from './types';
import {
  ibanLength,
  isCardNumber,
  isValidDob,
  isValidEmail,
  isValidIpv4,
  isValidIpv6,
  isValidPan,
  isValidSsn,
  isValidVerhoeff,
  phoneLength,
} from './validators';

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const BIRTH_LABEL =
  '(?:DOB|D\\.O\\.B\\.?|[Dd]ate [Oo]f [Bb]irth|[Bb]irth ?[Dd]ate|[Bb]irthday|[Bb]orn(?: [Oo]n)?)';
const BIRTH_DATE =
  `(?<=${BIRTH_LABEL}[\\x20\\t]*:?[\\x20\\t]*)(?:` +
  '\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}' +
  '|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}' +
  `|${MONTH}\\.?\\x20+\\d{1,2}(?:st|nd|rd|th)?,?\\x20+\\d{4}` +
  `|\\d{1,2}(?:st|nd|rd|th)?\\x20+${MONTH}\\.?,?\\x20+\\d{4})`;

/** Built-in Indian and international PII detection patterns with second-pass validators. */
export const BUILTIN_PATTERNS: Pattern[] = [
  {
    id: 'email',
    name: 'Email Address',
    category: 'EMAIL',
    group: 'intl',
    source: 'builtin',
    note: 'RFC-practical local/domain check rejecting version strings and malformed hosts',
    regex: '[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+',
    example: 'rahul@acme.com',
    enabled: true,
    validate: isValidEmail,
  },
  {
    id: 'in-pan',
    name: 'Indian PAN',
    category: 'PAN',
    group: 'in',
    source: 'builtin',
    note: 'Strict [A-Z]{5}[0-9]{4}[A-Z] with valid 4th-character entity code (PCHABGJLFT)',
    regex: '(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])',
    example: 'ABCPA1234F',
    enabled: true,
    validate: isValidPan,
  },
  {
    id: 'in-aadhaar',
    name: 'Indian Aadhaar',
    category: 'AADHAAR',
    group: 'in',
    source: 'builtin',
    note: '12 digits starting 2–9 with Verhoeff checksum verification',
    regex: '(?<![\\dA-Za-z+.-])\\d{4}[ -]?\\d{4}[ -]?\\d{4}(?![\\dA-Za-z-])(?!\\.\\d)',
    example: '2345 6789 0124',
    enabled: true,
    validate: isValidVerhoeff,
  },
  {
    id: 'in-phone',
    name: 'Indian Phone Number',
    category: 'PHONE',
    group: 'in',
    source: 'builtin',
    note: '+91, 0-prefixed, or 10-digit 6–9XXXXXXXX mobile numbers',
    regex:
      '(?<![\\w.+])(?:\\+91[\\x20.-]?[6-9]\\d{4}[\\x20.-]?\\d{5}|\\+91[\\x20.-]?[6-9]\\d{9}|0?[6-9]\\d{4}[\\x20-]\\d{5}|0?[6-9]\\d{9}|91[\\x20-][6-9]\\d{4}[\\x20-]?\\d{5})(?!\\w)',
    example: '+91 98765 43210, 9876543210',
    enabled: true,
    validate: phoneLength,
  },
  {
    id: 'intl-phone',
    name: 'International Phone Number',
    category: 'PHONE',
    group: 'intl',
    source: 'builtin',
    note: 'Country-code or North American formats validated with libphonenumber-js',
    regex:
      '(?<![\\w.+])(?:\\+[1-9]\\d{0,2}(?:[\\x20.-](?:\\(\\d{1,4}\\)|\\d{1,11})){1,6}|\\+[1-9]\\d{9,14}|(?:\\(\\d{3}\\)\\x20?|\\d{3}[-.\\x20])\\d{3}[-.\\x20]\\d{4})(?!\\w)',
    example: '+1 (415) 867-5309, +44 20 7946 0958',
    enabled: true,
    validate: phoneLength,
  },
  {
    id: 'credit-card',
    name: 'Credit / Debit Card',
    category: 'CREDIT_CARD',
    group: 'intl',
    source: 'builtin',
    note: 'Luhn mod-10 + issuer prefix + standard grouping (Visa, MC, Amex, Discover, JCB, UnionPay, Diners)',
    regex: '(?<![\\dA-Za-z+.-])\\d+(?:(?: \\d+){1,4}|(?:-\\d+){1,4})?(?![\\dA-Za-z-])(?!\\.\\d)',
    example: '4111-1111-1111-1111',
    enabled: true,
    validate: isCardNumber,
  },
  {
    id: 'us-ssn',
    name: 'US Social Security Number (SSN)',
    category: 'SSN',
    group: 'intl',
    source: 'builtin',
    note: 'Excludes unissued ranges (000, 666, 9xx, group 00, serial 0000); accepts labelled 9-digit SSNs',
    regex:
      '(?<![\\d-])(?:\\d{3}-\\d{2}-\\d{4}|\\d{3}\\x20\\d{2}\\x20\\d{4})(?![\\d-])' +
      '|(?<=(?:SSN|Social Security (?:Number|No\\.?))\\s*[:#]?\\s*)\\d{9}(?!\\d)',
    example: '123-45-6789, SSN: 078051121',
    enabled: true,
    validate: isValidSsn,
  },
  {
    id: 'iban',
    name: 'IBAN Bank Account',
    category: 'IBAN',
    group: 'intl',
    source: 'builtin',
    note: 'ISO 7064 mod-97 checksum and country-specific IBAN lengths',
    regex:
      '(?<![A-Za-z0-9])[A-Z]{2}\\d{2}(?:\\x20?[A-Z0-9]{4}){2,7}(?:\\x20?[A-Z0-9]{1,3})?(?![A-Za-z0-9])',
    example: 'GB82 WEST 1234 5698 7654 32',
    enabled: true,
    validate: ibanLength,
  },
  {
    id: 'ipv4',
    name: 'IPv4 Address',
    category: 'IP',
    group: 'intl',
    source: 'builtin',
    note: 'Octets 0–255 with no leading zeros; ignores version tags like v1.2.3.4',
    regex: '(?<![\\dA-Za-z.])\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}(?![\\dA-Za-z])(?!\\.\\d)',
    example: '192.168.10.42',
    enabled: true,
    validate: isValidIpv4,
  },
  {
    id: 'ipv6',
    name: 'IPv6 Address',
    category: 'IP',
    group: 'intl',
    source: 'builtin',
    note: 'Standard and compressed IPv6; rejects timestamps and MAC addresses',
    regex:
      '(?<![0-9A-Za-z:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Za-z:])',
    example: '2001:db8::1',
    enabled: true,
    validate: isValidIpv6,
  },
  {
    id: 'dob',
    name: 'Date of Birth',
    category: 'DOB',
    group: 'intl',
    source: 'builtin',
    note: 'Context-labelled DOB / Date of Birth / Born on dates with valid month/day',
    regex: BIRTH_DATE,
    example: '1985-03-14',
    enabled: true,
    validate: isValidDob,
  },
];
