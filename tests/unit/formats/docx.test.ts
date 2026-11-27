import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { LoadedDocument, TextEdit } from '../../../src/core/types';
import { generateDocx, parseDocx } from '../../../src/formats/docx';
import { readBlobBytes } from '../../../src/formats/segments';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`;

const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Reviewer: rahul@acme.example</w:t></w:r></w:p>
</w:hdr>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Customer Audit</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>PAN: </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>ABCPA</w:t></w:r>
      <w:r><w:t>1234F</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Phone</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>+91 98765</w:t></w:r><w:r><w:t> 43210</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

async function buildSampleDocxFile(name = 'sample.docx'): Promise<File> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/header1.xml', HEADER_XML);
  zip.file('word/document.xml', DOCUMENT_XML);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes as BlobPart], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function editFor(text: string, target: string, replacement: string): TextEdit {
  const start = text.indexOf(target);
  if (start < 0) throw new Error(`Target not found: ${target}`);
  return { start, end: start + target.length, replacement };
}

describe('docx format handler', () => {
  it('parses paragraphs, tables, headers, and layout metadata', async () => {
    const doc = await parseDocx(await buildSampleDocxFile());
    expect(doc.format).toBe('docx');
    expect(doc.text).toContain('Customer Audit');
    expect(doc.text).toContain('PAN: ABCPA1234F');
    expect(doc.text).toContain('+91 98765 43210');
    expect(doc.text).toContain('Reviewer: rahul@acme.example');
    expect(doc.layout?.kind).toBe('docx');
    if (doc.layout?.kind === 'docx') {
      expect(doc.layout.paragraphs.some((p) => p.style === 'heading')).toBe(true);
      expect(doc.layout.paragraphs.some((p) => p.part === 'header')).toBe(true);
      expect(doc.layout.paragraphs.some((p) => p.table !== undefined)).toBe(true);
    }
  });

  it('replaces split-run PII across document & header while preserving styles and structure', async () => {
    const originalDoc: LoadedDocument = await parseDocx(await buildSampleDocxFile());
    const edits: TextEdit[] = [
      editFor(originalDoc.text, 'ABCPA1234F', 'PAN_01'),
      editFor(originalDoc.text, '+91 98765 43210', 'PHONE_01'),
      editFor(originalDoc.text, 'rahul@acme.example', 'USER_01'),
    ];

    const blob = await generateDocx(originalDoc, edits);
    const outBytes = await readBlobBytes(blob);
    const reloaded = await parseDocx(new File([outBytes as BlobPart], 'out.docx'));

    expect(reloaded.text).toContain('PAN_01');
    expect(reloaded.text).toContain('PHONE_01');
    expect(reloaded.text).toContain('USER_01');
    expect(reloaded.text).not.toContain('ABCPA1234F');
    expect(reloaded.text).not.toContain('98765');
    expect(reloaded.text).not.toContain('rahul@acme.example');

    const outZip = await JSZip.loadAsync(outBytes);
    expect(await outZip.file('word/styles.xml')!.async('string')).toBe(STYLES_XML);
    const outDocXml = await outZip.file('word/document.xml')!.async('string');
    expect(outDocXml).not.toContain('ABCPA');
    expect(outDocXml).not.toContain('1234F');
    expect(outDocXml).not.toContain('43210');

    // Idempotent second generation from the same LoadedDocument
    const blob2 = await generateDocx(originalDoc, edits);
    const reloaded2 = await parseDocx(new File([(await readBlobBytes(blob2)) as BlobPart], 'out2.docx'));
    expect(reloaded2.text).toBe(reloaded.text);
  });

  it('rejects non-docx archives cleanly', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'not a docx');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(parseDocx(new File([bytes as BlobPart], 'bad.docx'))).rejects.toThrow(/Word/i);
  });
});
