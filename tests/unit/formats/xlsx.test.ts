import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { TextEdit } from '../../../src/core/types';
import { readBlobBytes } from '../../../src/formats/segments';
import { generateXlsx, parseXlsx } from '../../../src/formats/xlsx';

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Customers" sheetId="1" r:id="rId1"/>
    <sheet name="Audit" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts></styleSheet>`;

const SHARED_STRINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>Email</t></si>
  <si><t>rahul@acme.example</t></si>
  <si><t>ABCPA1234F</t></si>
  <si><t>Unused</t></si>
</sst>`;

const SHEET1_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>PAN</t></is></c></row>
    <row r="2"><c r="A2" t="s" s="1"><v>1</v></c><c r="B2" t="s" s="1"><v>2</v></c><c r="C2"><v>9876543210</v></c></row>
    <row r="3"><c r="A3" t="s" s="1"><v>1</v></c></row>
  </sheetData>
</worksheet>`;

const SHEET2_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Owner: priya@acme.example</t></is></c></row>
  </sheetData>
</worksheet>`;

async function buildSampleXlsxFile(includeSharedStrings = true): Promise<File> {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', WORKBOOK_XML);
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  zip.file('xl/styles.xml', STYLES_XML);
  if (includeSharedStrings) {
    zip.file('xl/sharedStrings.xml', SHARED_STRINGS_XML);
  }
  zip.file('xl/worksheets/sheet1.xml', SHEET1_XML);
  zip.file('xl/worksheets/sheet2.xml', SHEET2_XML);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes as BlobPart], 'sample.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function allEdits(text: string, target: string, replacement: string): TextEdit[] {
  const edits: TextEdit[] = [];
  let idx = 0;
  while ((idx = text.indexOf(target, idx)) >= 0) {
    edits.push({ start: idx, end: idx + target.length, replacement });
    idx += target.length;
  }
  return edits;
}

describe('xlsx format handler', () => {
  it('parses shared and inline strings across sheets and skips numeric cells', async () => {
    const doc = await parseXlsx(await buildSampleXlsxFile());
    expect(doc.text).toContain('Email\tPAN');
    expect(doc.text).toContain('rahul@acme.example\tABCPA1234F');
    expect(doc.text).toContain('Owner: priya@acme.example');
    expect(doc.text).not.toContain('9876543210');
    expect(doc.layout?.kind).toBe('xlsx');
  });

  it('scrubs orphaned shared strings, preserves styles, and rewrites changed cells as inlineStr', async () => {
    const doc = await parseXlsx(await buildSampleXlsxFile());
    const edits: TextEdit[] = [
      ...allEdits(doc.text, 'rahul@acme.example', 'USER_01'),
      ...allEdits(doc.text, 'ABCPA1234F', 'PAN_01'),
      ...allEdits(doc.text, 'priya@acme.example', 'USER_02'),
    ];

    const blob = await generateXlsx(doc, edits);
    const outBytes = await readBlobBytes(blob);
    const outZip = await JSZip.loadAsync(outBytes);

    expect(await outZip.file('xl/styles.xml')!.async('string')).toBe(STYLES_XML);

    for (const path of Object.keys(outZip.files)) {
      if (outZip.files[path].dir) continue;
      const content = await outZip.file(path)!.async('string');
      expect(content).not.toContain('rahul@acme.example');
      expect(content).not.toContain('ABCPA1234F');
      expect(content).not.toContain('priya@acme.example');
    }

    const reloaded = await parseXlsx(new File([outBytes as BlobPart], 'out.xlsx'));
    expect(reloaded.text).toContain('USER_01\tPAN_01');
    expect(reloaded.text).toContain('Owner: USER_02');
  });

  it('handles workbooks without sharedStrings.xml and rejects non-xlsx zips', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', SHEET2_XML);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const doc = await parseXlsx(new File([bytes as BlobPart], 'inline.xlsx'));
    expect(doc.text).toContain('Owner: priya@acme.example');

    const badZip = new JSZip();
    badZip.file('word/document.xml', '<w:document/>');
    const badBytes = await badZip.generateAsync({ type: 'uint8array' });
    await expect(parseXlsx(new File([badBytes as BlobPart], 'bad.xlsx'))).rejects.toThrow(/Excel/i);
  });
});
