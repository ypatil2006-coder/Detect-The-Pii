export interface SamplePreset {
  id: string;
  label: string;
  kind: 'txt' | 'csv';
  description: string;
  content: string;
}

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
