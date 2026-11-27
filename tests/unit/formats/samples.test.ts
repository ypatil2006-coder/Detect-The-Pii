import { describe, expect, it } from 'vitest';
import { parseDocx } from '../../../src/formats/docx';
import {
  buildSampleDocxFile,
  buildSamplePdfFile,
  buildSampleXlsxFile,
  getSampleById,
  MARKDOWN_SAMPLE_TEXT,
  SAMPLE_PRESETS,
} from '../../../src/formats/samples';
import { parseXlsx } from '../../../src/formats/xlsx';

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
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function checkVerhoeff(digits: string): boolean {
  let c = 0;
  const arr = digits.split('').reverse().map(Number);
  for (let i = 0; i < arr.length; i += 1) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][arr[i]]];
  }
  return c === 0;
}

function checkLuhn(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

describe('sample noisy text presets', () => {
  it('provides support-log, clinical-resume, and customers-csv presets', () => {
    const ids = SAMPLE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['support-log', 'clinical-resume', 'customers-csv']),
    );
    expect(getSampleById('support-log').kind).toBe('txt');
    expect(getSampleById('customers-csv').kind).toBe('csv');
    expect(() => getSampleById('missing-id')).toThrow();
  });

  it('includes valid Verhoeff Aadhaar, valid PAN, Luhn card, non-Luhn order ID, and recurring emails', () => {
    const combined = SAMPLE_PRESETS.map((p) => p.content).join('\n');

    // Valid PAN with 4th char in PCHABGJLFT
    const pans = combined.match(/\b[A-Z]{3}[PCHABGJLFT][A-Z][0-9]{4}[A-Z]\b/g) ?? [];
    expect(pans.length).toBeGreaterThanOrEqual(2);

    // At least one 12-digit Verhoeff-valid synthetic Aadhaar starting 2-9
    const twelveDigitMatches = combined.match(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g) ?? [];
    const validAadhaars = twelveDigitMatches
      .map((s) => s.replace(/[\s-]/g, ''))
      .filter((d) => checkVerhoeff(d));
    expect(validAadhaars.length).toBeGreaterThanOrEqual(2);

    // Both Luhn-valid test cards AND deliberate non-Luhn 16-digit order IDs
    const sixteenDigitMatches = combined.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g) ?? [];
    const normalized16 = sixteenDigitMatches.map((s) => s.replace(/[\s-]/g, ''));
    expect(normalized16.some((d) => checkLuhn(d))).toBe(true);
    expect(normalized16.some((d) => !checkLuhn(d))).toBe(true);

    // Recurring email across lines/rows for pseudonym consistency testing
    const emails = combined.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    const uniqueEmails = new Set(emails.map((e) => e.toLowerCase()));
    expect(emails.length).toBeGreaterThan(uniqueEmails.size);
  });

  it('builds synthetic Markdown, DOCX, XLSX, and PDF sample fixtures offline', async () => {
    expect(MARKDOWN_SAMPLE_TEXT).toContain('rahul.sharma@acme.example');
    expect(MARKDOWN_SAMPLE_TEXT).toContain('ABCPA1234F');

    const docx = await parseDocx(await buildSampleDocxFile());
    expect(docx.text).toContain('ABCPA1234F');

    const xlsx = await parseXlsx(await buildSampleXlsxFile());
    expect(xlsx.text).toContain('rahul.sharma@acme.example');

    const pdfFile = await buildSamplePdfFile();
    expect(pdfFile.name).toBe('sample-ticket.pdf');
    expect(pdfFile.size).toBeGreaterThan(500);
  });
});
