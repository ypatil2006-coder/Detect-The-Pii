import {
  createEmptyStats,
  type DetectionStats,
  type PiiMatch,
  type PiiType,
} from './types';
import {
  isValidEmail,
  isValidIpv4,
  isValidIpv6,
  isValidLuhn,
  isValidPan,
  isValidPhone,
  isValidVerhoeff,
  normalizeEntityValue,
} from './validators';

interface CandidateSpan {
  type: PiiType;
  value: string;
  start: number;
  end: number;
}

const TYPE_PRIORITY: Record<PiiType, number> = {
  EMAIL: 6,
  CREDIT_CARD: 5,
  AADHAAR: 4,
  PAN: 3,
  IP: 2,
  PHONE: 1,
};

const EMAIL_CANDIDATE_REGEX =
  /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PAN_CANDIDATE_REGEX =
  /(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])/g;
const IPV4_CANDIDATE_REGEX =
  /(?<![\dA-Za-z.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\dA-Za-z.])/g;
const IPV6_CANDIDATE_REGEX =
  /(?<![0-9A-Za-z:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Za-z:])/g;
const CARD_CANDIDATE_REGEX =
  /(?<![\dA-Za-z+.-])\d+(?:(?: \d+){1,4}|(?:-\d+){1,4})?(?![\dA-Za-z.-])/g;
const AADHAAR_CANDIDATE_REGEX =
  /(?<![\dA-Za-z+.-])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\dA-Za-z.-])/g;
const PHONE_CANDIDATE_REGEX =
  /(?<![\dA-Za-z.+])(?:\+\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?)?\d+(?:[ -]\d+){0,3}(?![\dA-Za-z])/g;

function scanMatches(regex: RegExp, text: string): Array<{ value: string; start: number; end: number }> {
  const results: Array<{ value: string; start: number; end: number }> = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    if (value.length > 0) {
      results.push({ value, start: match.index, end: match.index + value.length });
    }
  }
  return results;
}

function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Scans text for all 6 supported PII types using linear-time patterns,
 * validates candidates with checksum/format guards, resolves overlaps by
 * longest span then priority, and tracks rejected card/Aadhaar candidates.
 */
export function detectPii(text: string): {
  matches: PiiMatch[];
  stats: DetectionStats;
} {
  const stats = createEmptyStats();
  if (!text) {
    return { matches: [], stats };
  }

  const candidates: CandidateSpan[] = [];
  const rejectedCards: Array<{ start: number; end: number }> = [];
  const rejectedAadhaars: Array<{ start: number; end: number }> = [];

  for (const hit of scanMatches(EMAIL_CANDIDATE_REGEX, text)) {
    if (isValidEmail(hit.value)) {
      candidates.push({ type: 'EMAIL', ...hit });
    }
  }

  for (const hit of scanMatches(PAN_CANDIDATE_REGEX, text)) {
    if (isValidPan(hit.value)) {
      candidates.push({ type: 'PAN', ...hit });
    }
  }

  for (const hit of scanMatches(IPV4_CANDIDATE_REGEX, text)) {
    if (isValidIpv4(hit.value)) {
      candidates.push({ type: 'IP', ...hit });
    }
  }

  for (const hit of scanMatches(IPV6_CANDIDATE_REGEX, text)) {
    if (isValidIpv6(hit.value)) {
      candidates.push({ type: 'IP', ...hit });
    }
  }

  for (const hit of scanMatches(CARD_CANDIDATE_REGEX, text)) {
    const digitCount = hit.value.replace(/\D/g, '').length;
    if (digitCount < 13 || digitCount > 19) {
      continue;
    }
    if (isValidLuhn(hit.value)) {
      candidates.push({ type: 'CREDIT_CARD', ...hit });
    } else {
      rejectedCards.push({ start: hit.start, end: hit.end });
    }
  }

  for (const hit of scanMatches(AADHAAR_CANDIDATE_REGEX, text)) {
    if (isValidVerhoeff(hit.value)) {
      candidates.push({ type: 'AADHAAR', ...hit });
    } else {
      rejectedAadhaars.push({ start: hit.start, end: hit.end });
    }
  }

  for (const hit of scanMatches(PHONE_CANDIDATE_REGEX, text)) {
    if (isValidPhone(hit.value)) {
      candidates.push({ type: 'PHONE', ...hit });
    }
  }

  // Sort longest span first, then higher entity priority, then earliest offset
  candidates.sort((a, b) => {
    const lenDiff = (b.end - b.start) - (a.end - a.start);
    if (lenDiff !== 0) {
      return lenDiff;
    }
    const prioDiff = TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type];
    if (prioDiff !== 0) {
      return prioDiff;
    }
    return a.start - b.start;
  });

  const accepted: CandidateSpan[] = [];
  for (const cand of candidates) {
    const overlaps = accepted.some((existing) =>
      spansOverlap(cand.start, cand.end, existing.start, existing.end),
    );
    if (!overlaps) {
      accepted.push(cand);
    }
  }

  accepted.sort((a, b) => a.start - b.start);

  const matches: PiiMatch[] = accepted.map((cand, index) => {
    stats.total += 1;
    stats.byType[cand.type] += 1;
    return {
      id: `pii-${index + 1}`,
      type: cand.type,
      value: cand.value,
      normalized: normalizeEntityValue(cand.type, cand.value),
      start: cand.start,
      end: cand.end,
    };
  });

  stats.rejectedCreditCards = rejectedCards.filter(
    (rej) => !accepted.some((acc) => spansOverlap(rej.start, rej.end, acc.start, acc.end)),
  ).length;

  stats.rejectedAadhaar = rejectedAadhaars.filter(
    (rej) => !accepted.some((acc) => spansOverlap(rej.start, rej.end, acc.start, acc.end)),
  ).length;

  return { matches, stats };
}
