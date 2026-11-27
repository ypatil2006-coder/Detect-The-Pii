import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export interface SamplePreset {
  id: string;
  label: string;
  kind: 'txt' | 'csv';
  description: string;
  content: string;
}

export const MARKDOWN_SAMPLE_TEXT = [
  '# Incident Escalation Brief',
  '',
  '- **Reporter:** `rahul.sharma@acme.example` (`+91 98765 43210`)',
  '- **PAN / Aadhaar:** `ABCPA1234F` / `2345 6789 0124`',
  '- **Card (Luhn):** `4111-1111-1111-1111` | **Order Ref (non-Luhn):** `1234-5678-9012-3456`',
  '- **Source IP:** `192.168.10.42`',
].join('\n');

export const SAMPLE_PRESETS: SamplePreset[] = [
  {
    id: 'support-log',
    label: 'Support & Incident Log (.txt)',
    kind: 'txt',
    description:
      'Multi-line support ticket log with recurring emails, +91/US phones, IPv4/IPv6, PAN, Aadhaar, Luhn Visa card, and non-Luhn order IDs.',
    content: [
      '[2026-11-27T09:14:22Z] INFO Ticket #SUP-4091 opened by rahul.sharma@acme.example (Client IP: 192.168.10.42)',
      '[2026-11-27T09:14:29Z] WARN Gateway v2.4.1.0 rejected spoofed header 999.168.1.1; fallback IPv6 2001:0db8:85a3::8a2e:0370:7334',
      '[2026-11-27T09:15:02Z] INFO Callback requested on +91 98765 43210 or US desk +1 (415) 555-0192',
      '[2026-11-27T09:15:44Z] AUDIT KYC verified: PAN ABCPA1234F | Aadhaar 2345 6789 0124',
      '[2026-11-27T09:16:10Z] PAYMENT Order 1234-5678-9012-3456 billed to test card 4111-1111-1111-1111',
      '[2026-11-27T09:17:01Z] ESCALATE Assigned to priya.nair@acme.example; CC rahul.sharma@acme.example',
    ].join('\n'),
  },
  {
    id: 'clinical-resume',
    label: 'Clinical & Onboarding Note (.txt)',
    kind: 'txt',
    description:
      'Unstructured intake & verification memo with synthetic Aadhaar, PAN, Mastercard, and non-Luhn tracking ID.',
    content: [
      'Patient / Candidate Intake Summary (Synthesized Sample)',
      'Primary Contact: arjun.mehta@mail.example | Phone: +91-9811122334',
      'Attending Reviewer: dr.kavita@clinic.example (Extension IP: 10.24.8.15)',
      'Identity Documents: PAN XYZCH9876K, Aadhaar 4912-8734-0918',
      'Insurance Billing Card: 5500-0000-0000-0004 (Claim Ref: 9988776655443322)',
      'Follow-up Notice: Send redacted discharge summary to dr.kavita@clinic.example',
    ].join('\n'),
  },
  {
    id: 'customers-csv',
    label: 'Customer Audit Export (.csv)',
    kind: 'csv',
    description:
      'RFC-4180 CSV with quoted commas, recurring users across rows, Verhoeff Aadhaar, Luhn card, and non-Luhn order IDs.',
    content: [
      'customer_name,email,phone,kyc_id,payment_or_order,notes',
      '"Sharma, Rahul",rahul.sharma@acme.example,+91 98765 43210,ABCPA1234F,4111 1111 1111 1111,"Source IP 192.168.10.42, repeat check"',
      '"Nair, Priya",priya.nair@acme.example,+1 (415) 555-0192,6789 1234 5675,1234567890123456,"Order tracking ref (non-Luhn), PAN PQRTF5678M"',
      '"Sharma, Rahul",rahul.sharma@acme.example,+91 98765 43210,2345 6789 0124,5500-0000-0000-0004,"Secondary ticket by rahul.sharma@acme.example"',
    ].join('\n'),
  },
];

/** Returns a sample preset by ID or throws if the preset does not exist. */
export function getSampleById(id: string): SamplePreset {
  const preset = SAMPLE_PRESETS.find((item) => item.id === id);
  if (!preset) {
    throw new Error(`Unknown sample preset: ${id}`);
  }
  return preset;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Builds a synthetic `.docx` sample File in memory for 1-click multi-format demos and tests. */
export async function buildSampleDocxFile(fileName = 'sample-audit.docx'): Promise<File> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const paragraphs = SAMPLE_PRESETS[0].content
    .split('\n')
    .map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
  );
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes as BlobPart], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

/** Builds a synthetic `.xlsx` sample File in memory for 1-click multi-format demos and tests. */
export async function buildSampleXlsxFile(fileName = 'sample-customers.xlsx'): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Customers" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
  );
  const rowsXml = [
    ['Customer', 'Email', 'PAN', 'Aadhaar', 'Card'],
    ['Rahul Sharma', 'rahul.sharma@acme.example', 'ABCPA1234F', '2345 6789 0124', '4111-1111-1111-1111'],
    ['Priya Nair', 'priya.nair@acme.example', 'PQRTF5678M', '6789 1234 5675', '1234567890123456'],
  ]
    .map((cells, rIdx) => {
      const rowNum = rIdx + 1;
      const cellXml = cells
        .map((val, cIdx) => {
          const col = String.fromCharCode(65 + cIdx);
          return `<c r="${col}${rowNum}" t="inlineStr"><is><t>${escapeXml(val)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}">${cellXml}</row>`;
    })
    .join('');
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
  );
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes as BlobPart], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Builds a synthetic text-layer `.pdf` sample File in memory without network calls. */
export async function buildSamplePdfFile(fileName = 'sample-ticket.pdf'): Promise<File> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  SAMPLE_PRESETS[0].content.split('\n').forEach((line, i) => {
    page.drawText(line, { x: 40, y: 780 - i * 20, size: 10, font });
  });
  const bytes = await pdf.save();
  return new File([bytes as BlobPart], fileName, { type: 'application/pdf' });
}
