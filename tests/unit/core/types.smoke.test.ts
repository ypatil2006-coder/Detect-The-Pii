import { describe, expect, it } from 'vitest';
import {
  createEmptyStats,
  createPseudonymState,
  type DetectionStats,
  type DiffRow,
  type DiffSegment,
  type PiiMatch,
  type PiiType,
  type PseudonymMapEntry,
  type PseudonymState,
  type RedactionMode,
  type SanitizeFn,
  type SanitizeResult,
} from '../../../src/core/types';

describe('core types contract', () => {
  it('createEmptyStats returns zeroed counts for all 6 PII types', () => {
    const stats: DetectionStats = createEmptyStats();

    expect(stats.total).toBe(0);
    expect(stats.rejectedCreditCards).toBe(0);
    expect(stats.rejectedAadhaar).toBe(0);
    expect(stats.byType).toEqual({
      EMAIL: 0,
      PHONE: 0,
      IP: 0,
      PAN: 0,
      AADHAAR: 0,
      CREDIT_CARD: 0,
    });
  });

  it('createPseudonymState initializes empty map and zeroed counters', () => {
    const state: PseudonymState = createPseudonymState();

    expect(state.map).toBeInstanceOf(Map);
    expect(state.map.size).toBe(0);
    expect(state.counters).toEqual({
      EMAIL: 0,
      PHONE: 0,
      IP: 0,
      PAN: 0,
      AADHAAR: 0,
      CREDIT_CARD: 0,
    });
  });

  it('supports all locked interfaces', () => {
    const type: PiiType = 'EMAIL';
    const mode: RedactionMode = 'pseudonym';
    const match: PiiMatch = {
      id: 'm1',
      type,
      value: 'alice@acme.com',
      normalized: 'alice@acme.com',
      start: 0,
      end: 14,
    };
    const entry: PseudonymMapEntry = {
      placeholder: 'USER_01',
      type,
      maskedPreview: 'a***@acme.com',
      count: 1,
    };
    const segment: DiffSegment = {
      text: 'USER_01',
      kind: 'redacted',
      type,
      placeholder: 'USER_01',
    };
    const row: DiffRow = {
      lineNumber: 1,
      hasChanges: true,
      originalSegments: [{ text: 'alice@acme.com', kind: 'pii', type }],
      sanitizedSegments: [segment],
    };
    const fn: SanitizeFn = (text, m) => {
      const result: SanitizeResult = {
        original: text,
        sanitized: 'USER_01',
        mode: m,
        matches: [match],
        stats: createEmptyStats(),
        pseudonyms: [entry],
        durationMs: 0,
      };
      return result;
    };

    expect(row.hasChanges).toBe(true);
    expect(fn('alice@acme.com', mode).sanitized).toBe('USER_01');
  });
});
