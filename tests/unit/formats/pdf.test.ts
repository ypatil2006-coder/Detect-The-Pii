import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TextEdit } from '../../../src/core/types';
import { generatePdf, parsePdf } from '../../../src/formats/pdf';
import { readBlobBytes } from '../../../src/formats/segments';

const FONT = new Uint8Array(readFileSync('public/fonts/NotoSansTC-Regular.ttf'));

async function buildSamplePdf(lines: string[]): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(FONT, { subset: true });
  const page = pdf.addPage([595, 842]);
  lines.forEach((line, i) => {
    page.drawText(line, { x: 50, y: 780 - i * 24, size: 12, font });
  });
  const bytes = await pdf.save();
  return new File([bytes as BlobPart], 'sample.pdf', { type: 'application/pdf' });
}

beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response(FONT));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  ).href;
});

describe('pdf format handler', () => {
  it('extracts positioned text and rebuilds a clean PDF with zero lingering raw PII', async () => {
    const lines = [
      'Customer: Rahul Sharma (PAN ABCPA1234F)',
      'Email: rahul@acme.example | Phone: +91 98765 43210',
    ];
    const doc = await parsePdf(await buildSamplePdf(lines));
    expect(doc.text).toContain('ABCPA1234F');
    expect(doc.text).toContain('rahul@acme.example');

    const edits: TextEdit[] = [
      {
        start: doc.text.indexOf('ABCPA1234F'),
        end: doc.text.indexOf('ABCPA1234F') + 'ABCPA1234F'.length,
        replacement: 'PAN_01',
      },
      {
        start: doc.text.indexOf('rahul@acme.example'),
        end: doc.text.indexOf('rahul@acme.example') + 'rahul@acme.example'.length,
        replacement: 'USER_01',
      },
    ];

    const blob = await generatePdf(doc, edits);
    const outBytes = await readBlobBytes(blob);
    const outDoc = await parsePdf(new File([outBytes as BlobPart], 'redacted.pdf'));
    expect(outDoc.text).toContain('PAN_01');
    expect(outDoc.text).toContain('USER_01');
    expect(outDoc.text).not.toContain('ABCPA1234F');
    expect(outDoc.text).not.toContain('rahul@acme.example');

    const rawBytes = Buffer.from(outBytes).toString('latin1');
    expect(rawBytes).not.toContain('ABCPA1234F');
    expect(rawBytes).not.toContain('rahul@acme.example');
  });

  it('rejects a PDF without a text layer when OCR is disabled', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const file = new File([(await pdf.save()) as BlobPart], 'blank.pdf');
    await expect(parsePdf(file)).rejects.toThrow(/text layer/i);
  });
});
