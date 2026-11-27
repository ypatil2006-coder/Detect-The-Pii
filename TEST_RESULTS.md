# Test Results & Security Audit

> **Last run:** 2026-11-27 · **Status:** ✅ 184 tests passing / 30 test files / 0 failures

---

## Test Suite Summary

```
Test Files  30 passed (30)
     Tests  184 passed (184)
  Start at  2026-11-27
  Duration  ~5s
```

---

## Security Test Results (`tests/unit/core/security.test.ts`)

| Test | Result | Time |
|---|---|---|
| ReDoS: 10 000-char all-digit string scanned in linear time | ✅ PASS | 78ms |
| ReDoS: 5 000-char mixed-symbol string — no backtracking | ✅ PASS | 1ms |
| ReDoS: 5 000-char invalid-IPv4 string — no catastrophic backtracking | ✅ PASS | 2ms |
| XSS: `<script>alert("xss")</script>` passed through as literal text | ✅ PASS | 0ms |
| XSS: HTML event attributes literal; real email redacted correctly | ✅ PASS | 1ms |
| XSS: Null bytes and control characters handled without throwing | ✅ PASS | 1ms |
| False positive: out-of-range IPv4 octets (999.999.1.1) not flagged | ✅ PASS | 0ms |
| False positive: non-Luhn 16-digit order/tracking ID not flagged as card | ✅ PASS | 0ms |
| False positive: uniform repeated digits (1111 1111 1111) not flagged as Aadhaar | ✅ PASS | 1ms |
| False positive: Unix timestamp not flagged as phone number | ✅ PASS | 0ms |
| Luhn: 15-digit Amex (378282246310005) accepted | ✅ PASS | 0ms |
| Luhn: all-zero string rejected | ✅ PASS | 0ms |
| Luhn: < 13 digits rejected | ✅ PASS | 0ms |
| Luhn: > 19 digits rejected | ✅ PASS | 0ms |
| Luhn: hyphen-separated card accepted | ✅ PASS | 0ms |
| Resilience: 100 000-character document handled without throwing | ✅ PASS | 163ms |
| Resilience: PII correctly detected in large 100K-char document | ✅ PASS | 1ms |

**17 / 17 security tests passing ✅**

---

## Full Test Coverage by Layer

### Unit — Core Validators (`tests/unit/core/validators.test.ts`)
- ✅ Luhn mod-10: valid Visa/Mastercard/Amex + random 16-digit rejection
- ✅ Verhoeff checksum: valid Aadhaar + invalid check digits / 0–1 prefix / repeated digits
- ✅ PAN: valid formats + invalid 4th-char / lowercase / malformed
- ✅ IPv4: valid octets + out-of-range / leading zeros / version strings
- ✅ IPv6: full + compressed + rejects timestamps / MACs
- ✅ Email: RFC-practical + rejects handles / version strings
- ✅ Phone: Indian (+91, 0-prefix, 10-digit) + international (libphonenumber-js)
- ✅ Luhn boundary: 13-digit min, 19-digit max, 20-digit reject
- ✅ Card issuer prefix + standard grouping validation
- ✅ SSN: issued ranges (excludes 000, 666, 9xx, 00, 0000)
- ✅ IBAN: mod-97 checksum + country-specific lengths
- ✅ DOB: ISO / slash / English month-name formats
- ✅ Normalize: deterministic per-type entity normalization

### Unit — Redaction Modes (`tests/unit/core/redactor.test.ts`)
- ✅ Full Mask: `[REDACTED]` replacement
- ✅ Partial Mask: format-preserving (`j***@example.com`, `AB***1234F`, etc.)
- ✅ Consistent Pseudonymization: deterministic `USER_01` / `PHONE_01` cross-line
- ✅ Category Tag: `[EMAIL]` / `[PHONE]` / `[PAN]` markers
- ✅ Blank: `○○○○○○○` replacement
- ✅ Restore round-trip: `.mapping.csv` → original text recovered

### Unit — Overlap Resolution
- ✅ Longest-span-wins without corrupting character offsets
- ✅ Adjacent spans handled correctly
- ✅ Manual redaction items merged safely

### Unit — Document Formats
- ✅ `.txt` / `.md`: BOM/CRLF normalization, full pipeline
- ✅ `.csv`: RFC-4180 (quoted commas, escaped quotes, embedded newlines)
- ✅ `.docx`: OOXML paragraph/table/header extraction + sanitized rebuild
- ✅ `.xlsx`: SharedStrings + inline strings, cell rebuild
- ✅ `.pdf`: text-layer extraction + clean PDF rebuild (zero raw PII in bytes)
- ✅ Scanned PDF: OCR layout extraction, digit confusable repair
- ✅ Batch ZIP: shared pseudonym state, merged mapping, manifest.csv

### Integration — End-to-End Pipeline
- ✅ Multi-format pipeline timing across all 5 redaction modes
- ✅ Support log, clinical note, customer CSV sample audits
- ✅ Pseudonym consistency across document and CSV rows
- ✅ Batch archive with 4+ formats and shared mapping

### Integration — UI & Security (`tests/integration/app.test.tsx`)
- ✅ Semantic landmarks + keyboard navigation
- ✅ 1-click sample loader → Checklist + Diff + Audit populated
- ✅ All 5 redaction modes + "Changed lines only" toggle
- ✅ Suggestion toggles, category mute, manual redaction, overlap guard
- ✅ **XSS: `<script>alert(1)</script>` renders as harmless text node**
- ✅ Unicode / RTL text handled safely
- ✅ Dark ↔ Light theme toggle + localStorage persistence
- ✅ `prefers-reduced-motion` respected in pipeline animation
- ✅ Custom RegExp rules, offline CSV restore, Blob downloads
- ✅ WCAG 2.1 AA: `aria-live`, visible focus rings, accessible labels

---

## Dependency Security Audit (`npm audit`)

```
3 vulnerabilities (1 moderate, 2 critical)
  tinypool — Prototype Pollution Gadget to RCE in run() options
  GHSA-85c8-ppgw-ccpr
```

> **Impact: Zero.** `tinypool` is a dependency of **Vitest** (dev/test tooling only). It is not present in the production build (`dist/`) and is never executed in a deployed environment. The production Vite bundle contains none of the affected code. Users of the live application are not exposed to this vulnerability.
>
> Fix available via `npm audit fix --force` (upgrades Vitest to v5 — a breaking change deferred to avoid test suite disruption during the submission window).

### Production Build Verification
```bash
npm run build          # ✅ 0 TypeScript errors, 0 lint warnings
npx tsc --noEmit       # ✅ Strict mode — no implicit any, no null unsafe
npm run lint           # ✅ ESLint — 0 errors, 0 warnings
```

---

## Running the Tests

```bash
git clone https://github.com/ypatil2006-coder/Detect-The-Pii.git
cd Detect-The-Pii
npm install
npm test                   # 184 tests, 30 files, all passing
npm test -- --run          # Non-watch mode
npm test -- --run tests/unit/core/security.test.ts  # Security tests only
```
