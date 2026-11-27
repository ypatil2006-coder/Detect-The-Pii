import { describe, expect, it } from 'vitest';
import { analyzeDocument } from '../../src/core/document-pipeline';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { restore } from '../../src/core/restorer';
import type { MarkerStyle } from '../../src/core/types';
import { parsePlainText } from '../../src/formats/plaintext';

const ENGLISH_AND_INDIA_SAMPLE = [
  'Candidate Onboarding & Compliance Audit',
  'DOB: March 14, 1985 | SSN: 219-09-9999',
  'Email: emily.carter@example.com | Backup: emily.carter@example.com',
  'Phones: +1 (415) 867-5309, (416) 967-1111, +44 20 7946 0958, +91 98765 43210',
  'Cards: 4242 4242 4242 4242, 3782 822463 10005',
  'Banking: GB82 WEST 1234 5698 7654 32, DE89370400440532013000',
  'India KYC: PAN ABCPA1234F, Aadhaar 2345 6789 0124',
  'Network: 192.168.1.10, 2001:db8::1',
  '--- Planted Noise (must NOT be redacted) ---',
  'Order #1234-5678-9012-3456 | Build v1.2.3.4 | Bad IP 999.168.1.1 | Time 12:30:45 | MAC 00:1A:2B:3C:4D:5E',
  'Invalid SSN 000-12-3456 | Invoice Date: 2026-10-16 | Tracking 1000000000000008',
].join('\n');

const SENSITIVE_VALUES = [
  'March 14, 1985',
  '219-09-9999',
  'emily.carter@example.com',
  '+1 (415) 867-5309',
  '(416) 967-1111',
  '+44 20 7946 0958',
  '+91 98765 43210',
  '4242 4242 4242 4242',
  '3782 822463 10005',
  'GB82 WEST 1234 5698 7654 32',
  'DE89370400440532013000',
  'ABCPA1234F',
  '2345 6789 0124',
  '192.168.1.10',
  '2001:db8::1',
];

const NOISE_VALUES = [
  '1234-5678-9012-3456',
  'v1.2.3.4',
  '999.168.1.1',
  '12:30:45',
  '00:1A:2B:3C:4D:5E',
  '000-12-3456',
  '2026-10-16',
  '1000000000000008',
];

describe('English + India multi-entity sample audit', () => {
  it.each<MarkerStyle>(['full', 'partial', 'pseudonym', 'category', 'blank'])(
    'redacts every sensitive value and leaves all planted noise intact in %s mode',
    async (style) => {
      const doc = await parsePlainText(
        new File([ENGLISH_AND_INDIA_SAMPLE], 'english-sample.txt'),
        'txt',
      );
      const session = analyzeDocument(doc, BUILTIN_PATTERNS, style);

      for (const secret of SENSITIVE_VALUES) {
        expect(session.sanitizedText, `leaked ${secret}`).not.toContain(secret);
      }
      for (const noise of NOISE_VALUES) {
        expect(session.sanitizedText, `false positive on ${noise}`).toContain(noise);
      }
      expect(session.stats.rejectedCreditCards).toBeGreaterThanOrEqual(1);
    },
  );

  it('restores the full sample verbatim from pseudonym mappings', async () => {
    const doc = await parsePlainText(
      new File([ENGLISH_AND_INDIA_SAMPLE], 'english-sample.txt'),
      'txt',
    );
    const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'pseudonym');
    const restored = restore(session.sanitizedText, session.mappings);

    expect(restored.missingCodes).toEqual([]);
    expect(restored.restoredText).toBe(ENGLISH_AND_INDIA_SAMPLE);
  });
});
