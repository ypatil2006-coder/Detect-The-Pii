import { describe, expect, it } from 'vitest';
import { buildSideBySideDiff } from '../../../src/core/diff';
import { detectPii } from '../../../src/core/detector';

describe('buildSideBySideDiff', () => {
  it('builds line-aligned DiffRows preserving plain lines and highlighting PII/redacted spans', () => {
    const original = [
      'User rahul@acme.com logged in from 192.168.1.10',
      'Status: OK (no sensitive fields here)',
      'Backup contact: rahul@acme.com | PAN ABCPA1234F',
    ].join('\n');

    const { matches } = detectPii(original);
    const replacements = ['USER_01', 'IP_01', 'USER_01', 'PAN_01'];
    const rows = buildSideBySideDiff(original, matches, 'pseudonym', replacements);

    expect(rows).toHaveLength(3);
    expect(rows[0].lineNumber).toBe(1);
    expect(rows[0].hasChanges).toBe(true);
    expect(rows[1].lineNumber).toBe(2);
    expect(rows[1].hasChanges).toBe(false);
    expect(rows[2].lineNumber).toBe(3);
    expect(rows[2].hasChanges).toBe(true);

    const originalLines = original.split('\n');
    expect(rows[0].originalSegments.map((s) => s.text).join('')).toBe(originalLines[0]);
    expect(rows[1].originalSegments.map((s) => s.text).join('')).toBe(originalLines[1]);
    expect(rows[2].originalSegments.map((s) => s.text).join('')).toBe(originalLines[2]);

    expect(rows[0].sanitizedSegments.map((s) => s.text).join('')).toBe(
      'User USER_01 logged in from IP_01',
    );
    expect(rows[1].sanitizedSegments.map((s) => s.text).join('')).toBe(originalLines[1]);
    expect(rows[2].sanitizedSegments.map((s) => s.text).join('')).toBe(
      'Backup contact: USER_01 | PAN PAN_01',
    );

    expect(rows[0].originalSegments.filter((s) => s.kind === 'pii')).toEqual([
      { text: 'rahul@acme.com', kind: 'pii', type: 'EMAIL' },
      { text: '192.168.1.10', kind: 'pii', type: 'IP' },
    ]);
    expect(rows[0].sanitizedSegments.filter((s) => s.kind === 'redacted')).toEqual([
      { text: 'USER_01', kind: 'redacted', type: 'EMAIL', placeholder: 'USER_01' },
      { text: 'IP_01', kind: 'redacted', type: 'IP', placeholder: 'IP_01' },
    ]);
  });

  it('omits placeholder property in full/partial modes and handles empty lines', () => {
    const original = 'Email rahul@acme.com\n\nDone';
    const { matches } = detectPii(original);
    const rows = buildSideBySideDiff(original, matches, 'full', ['[REDACTED]']);

    expect(rows).toHaveLength(3);
    expect(rows[1].hasChanges).toBe(false);
    expect(rows[1].originalSegments.map((s) => s.text).join('')).toBe('');
    expect(rows[0].sanitizedSegments.find((s) => s.kind === 'redacted')).toEqual({
      text: '[REDACTED]',
      kind: 'redacted',
      type: 'EMAIL',
    });
  });
});
