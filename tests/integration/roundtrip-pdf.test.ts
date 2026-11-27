import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeDocument, buildExportBlob } from '../../src/core/document-pipeline';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { restore } from '../../src/core/restorer';
import { parseMapping } from '../../src/formats/csv';
import { parsePdf } from '../../src/formats/pdf';
import { buildSamplePdfFile, getSampleById } from '../../src/formats/samples';
import { readBlobBytes } from '../../src/formats/segments';

const FONT = new Uint8Array(readFileSync('public/fonts/NotoSansTC-Regular.ttf'));

async function buildFittedPdf(lines: string[]): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(FONT, { subset: true });
  const page = pdf.addPage([842, 595]);
  lines.forEach((line, i) => {
    page.drawText(line, { x: 40, y: 540 - i * 22, size: 10, font });
  });
  const bytes = await pdf.save();
  return new File([bytes as BlobPart], 'ticket.pdf', { type: 'application/pdf' });
}

beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response(FONT));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  ).href;
});

describe('PDF roundtrip through document-pipeline', () => {
  it('rebuilds a clean PDF with zero raw PII in text layer or raw bytes and restores via mapping', async () => {
    const lines = getSampleById('support-log').content.split('\n');
    const doc = await parsePdf(await buildFittedPdf(lines));
    const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'pseudonym');

    expect(session.items.length).toBeGreaterThanOrEqual(7);
    expect(session.stats.rejectedCreditCards).toBe(1);

    const { sanitizedBlob, mappingCsv, fileName } = await buildExportBlob(session, 'pseudonym');
    expect(fileName).toBe('ticket.sanitized-pseudonym.pdf');

    const outBytes = await readBlobBytes(sanitizedBlob);
    const outDoc = await parsePdf(new File([outBytes as BlobPart], fileName));
    expect(outDoc.text).toContain('USER_01');
    expect(outDoc.text).toContain('1234-5678-9012-3456');

    const rawPdf = Buffer.from(outBytes).toString('latin1');
    for (const item of session.items.filter((i) => i.active)) {
      expect(outDoc.text).not.toContain(item.original);
      expect(rawPdf).not.toContain(item.original);
    }

    const parsedMap = parseMapping(mappingCsv);
    expect(parsedMap.errors).toEqual([]);
    const restored = restore(outDoc.text, parsedMap.entries);
    expect(restored.missingCodes).toEqual([]);
    expect(restored.restoredText.replace(/\s/g, '')).toBe(doc.text.replace(/\s/g, ''));
  });

  it('sanitizes built-in buildSamplePdfFile with zero raw PII remaining', async () => {
    const doc = await parsePdf(await buildSamplePdfFile('demo.pdf'));
    const session = analyzeDocument(doc, BUILTIN_PATTERNS, 'full');
    const { sanitizedBlob } = await buildExportBlob(session, 'full');
    const outBytes = await readBlobBytes(sanitizedBlob);
    const outDoc = await parsePdf(new File([outBytes as BlobPart], 'demo.out.pdf'));

    expect(outDoc.text).toContain('[REDACTED]');
    for (const item of session.items.filter((i) => i.active)) {
      expect(outDoc.text).not.toContain(item.original);
    }
  });
});
