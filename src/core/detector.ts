import { CodeBook } from './codes';
import { splitFor } from './retention';
import {
  createEmptyStats,
  type Category,
  type DetectionStats,
  type Pattern,
  type PiiMatch,
  type PiiType,
  type RedactionItem,
  type Retention,
} from './types';
import {
  isValidEmail,
  isValidIpv4,
  isValidIpv6,
  isValidLuhn,
  isValidPan,
  isValidVerhoeff,
  normalizeEntityValue,
  phoneLength,
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
  /(?<![\dA-Za-z.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\dA-Za-z])(?!\.\d)/g;
const IPV6_CANDIDATE_REGEX =
  /(?<![0-9A-Za-z:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Za-z:])/g;
const CARD_CANDIDATE_REGEX =
  /(?<![\dA-Za-z+.-])\d+(?:(?: \d+){1,4}|(?:-\d+){1,4})?(?![\dA-Za-z-])(?!\.\d)/g;
const AADHAAR_CANDIDATE_REGEX =
  /(?<![\dA-Za-z+.-])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\dA-Za-z-])(?!\.\d)/g;
const PHONE_CANDIDATE_REGEX =
  /(?<![\w.+])(?:\+[1-9]\d{0,2}(?:[ .-](?:\(\d{1,4}\)|\d{1,11})){1,6}|\+[1-9]\d{9,14}|(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}|(?:0?[6-9]\d{9}|0?[6-9]\d{4}[ -]\d{5}|91[ -][6-9]\d{4}[ -]?\d{5}))(?![\w])/g;

function scanMatches(
  regex: RegExp,
  text: string,
): Array<{ value: string; start: number; end: number }> {
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

function spansOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Scans text for all 6 core PII types using linear-time patterns,
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

  PHONE_CANDIDATE_REGEX.lastIndex = 0;
  let phoneMatch: RegExpExecArray | null;
  while ((phoneMatch = PHONE_CANDIDATE_REGEX.exec(text)) !== null) {
    const raw = phoneMatch[0];
    if (!raw) {
      PHONE_CANDIDATE_REGEX.lastIndex++;
      continue;
    }
    const acceptedLen = phoneLength(raw);
    if (acceptedLen !== false && acceptedLen > 0) {
      const value = raw.slice(0, acceptedLen);
      candidates.push({
        type: 'PHONE',
        value,
        start: phoneMatch.index,
        end: phoneMatch.index + acceptedLen,
      });
      if (acceptedLen < raw.length) {
        PHONE_CANDIDATE_REGEX.lastIndex = phoneMatch.index + acceptedLen;
      }
    }
  }

  candidates.sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
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

/* -------------------------------------------------------------------------- */
/* Multi-pattern interactive document detection & manual redaction management  */
/* -------------------------------------------------------------------------- */

let nextItemId = 1;
function newItemId(): string {
  return `r${nextItemId++}`;
}

interface PatternCandidate {
  category: Category;
  start: number;
  end: number;
  retention?: Retention;
}

function applySplit(
  item: RedactionItem,
  retention: Retention | undefined,
  book: CodeBook,
): void {
  const { head, tail } = splitFor(item.original, retention, item.category);
  if (head) {
    item.head = head;
  } else {
    delete item.head;
  }
  if (tail) {
    item.tail = tail;
  } else {
    delete item.tail;
  }
  item.code = book.codeFor(item.category, item.original, head, tail);
}

function makeItem(
  text: string,
  start: number,
  end: number,
  category: Category,
  book: CodeBook,
  origin: 'auto' | 'manual',
  retention?: Retention,
): RedactionItem {
  const original = text.slice(start, end);
  const item: RedactionItem = {
    id: newItemId(),
    category,
    original,
    start,
    end,
    code: '',
    origin,
    active: true,
  };
  if (retention) {
    item.retention = retention;
  }
  applySplit(item, retention, book);
  return item;
}

/** Re-computes retention splits and codes across all detected/manual items. */
export function resplitItems(
  items: RedactionItem[],
  book: CodeBook,
  resolve: (it: RedactionItem) => Retention | undefined,
): void {
  for (const it of items) {
    applySplit(it, resolve(it), book);
  }
}

/** Compiles a `Pattern` into a global Unicode `RegExp`, returning `null` if invalid. */
export function compilePattern(p: Pattern): RegExp | null {
  try {
    return new RegExp(p.regex, 'gu');
  } catch {
    return null;
  }
}

function resolvePatternOverlaps(cands: PatternCandidate[]): PatternCandidate[] {
  const sorted = [...cands].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const chosen: PatternCandidate[] = [];
  for (const c of sorted) {
    if (chosen.every((k) => c.end <= k.start || c.start >= k.end)) {
      chosen.push(c);
    }
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** Runs enabled built-in and custom `Pattern[]` rules over `text`, returning `RedactionItem[]`. */
export function detect(
  text: string,
  patterns: Pattern[],
  book: CodeBook = new CodeBook(),
): RedactionItem[] {
  const cands: PatternCandidate[] = [];
  for (const p of patterns) {
    if (!p.enabled) {
      continue;
    }
    const re = compilePattern(p);
    if (!re) {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const verdict = p.validate
        ? p.validate(m[0], text.slice(Math.max(0, m.index - 3), m.index))
        : true;
      if (verdict === false || verdict === 0) {
        re.lastIndex = m.index + Math.min(2, m[0].length);
        continue;
      }
      const length =
        verdict === true ? m[0].length : Math.min(verdict, m[0].length);
      if (length < m[0].length) {
        re.lastIndex = m.index + length;
      }
      cands.push({
        category: p.category,
        start: m.index,
        end: m.index + length,
        retention: p.retention,
      });
    }
  }
  return resolvePatternOverlaps(cands).map((c) =>
    makeItem(text, c.start, c.end, c.category, book, 'auto', c.retention),
  );
}

/** Error thrown when adding or re-activating an item that overlaps an active item. */
export class OverlapError extends Error {
  constructor() {
    super('Selection overlaps an existing active redaction item.');
  }
}

/** Adds a manual redaction span, throwing `OverlapError` if it overlaps any active item. */
export function addManualItem(
  items: RedactionItem[],
  text: string,
  start: number,
  end: number,
  category: Category,
  book: CodeBook,
  retention?: Retention,
): RedactionItem {
  if (start < 0 || end > text.length || start >= end) {
    throw new Error('Invalid selection range.');
  }
  const overlaps = items.some(
    (it) => it.active && start < it.end && end > it.start,
  );
  if (overlaps) {
    throw new OverlapError();
  }
  const item = makeItem(text, start, end, category, book, 'manual', retention);
  const next = [...items, item].sort((a, b) => a.start - b.start);
  items.length = 0;
  items.push(...next);
  return item;
}

/** Toggles an item's `active` flag, guarding against overlaps on re-activation. */
export function toggleItem(
  items: RedactionItem[],
  id: string,
): RedactionItem | undefined {
  const it = items.find((x) => x.id === id);
  if (!it) {
    return undefined;
  }
  if (!it.active) {
    const overlaps = items.some(
      (o) => o.active && o.id !== id && it.start < o.end && it.end > o.start,
    );
    if (overlaps) {
      throw new OverlapError();
    }
  }
  it.active = !it.active;
  return it;
}
