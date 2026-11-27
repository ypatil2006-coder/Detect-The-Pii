# Detect the PII — Client-Side Browser PII Sanitizer

[![CI](https://github.com/ypatil2006-coder/Detect-The-Pii/actions/workflows/ci.yml/badge.svg)](https://github.com/ypatil2006-coder/Detect-The-Pii/actions/workflows/ci.yml)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-detect--the--pii.vercel.app-brightgreen?logo=vercel)](https://detect-the-pii.vercel.app)
[![LinkedIn Demo Post](https://img.shields.io/badge/LinkedIn-Demo%20Post-0A66C2?logo=linkedin)](https://lnkd.in/p/gSGKUmN5)
[![Tests](https://img.shields.io/badge/Tests-184%20passing%20%2F%2030%20files-success?logo=vitest)](./tests)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](./tsconfig.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](./package.json)

> **Deployment Note:** This project is deployed on **Vercel** (`vercel.json` + static Vite `dist/`). Full Docker / Cloud Run parity is maintained via `Dockerfile`, `nginx.conf`, `cloudbuild.yaml`, `$PORT=8080`, and `/healthz`.

---

## Chosen Vertical

**Privacy & Data Security** — A smart, browser-native PII detection and redaction assistant that helps developers, support agents, healthcare workers, and data analysts safely sanitize sensitive documents before sharing or processing them.

---

## Approach & Logic

The core design principle is **zero-trust data handling**: sensitive documents should never leave the user's device. All intelligence runs client-side.

### How it makes decisions

1. **Input Parsing** — Detects file type (`.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`) and routes to the appropriate parser. Scanned PDFs automatically fall back to self-hosted OCR (Tesseract.js WASM).

2. **Pattern Scan** — Multi-pass regex engine using non-backtracking, ReDoS-safe patterns for 10+ PII categories. Each candidate is tagged with its category, position, and raw value.

3. **Validation Layer** — Raw regex matches are validated with domain-specific algorithms:
   - Credit cards → **Luhn mod-10** checksum
   - Aadhaar → **Verhoeff checksum** (digit-permutation group)
   - PAN → 4th-character entity-type validation (`P/C/H/A/B/G/J/L/F/T`)
   - Phones → **libphonenumber-js** E.164 validation
   - IBAN → **mod-97** checksum

4. **Overlap Resolution** — Deterministic longest-span-wins algorithm resolves conflicting candidate spans without corrupting character offsets.

5. **Mode Operator** — Applies the user-selected redaction mode (Full Mask / Partial Mask / Consistent Pseudonymization / Category Tag / Blank Placeholder) across all validated entities, maintaining cross-line and cross-file pseudonym consistency.

6. **Diff & Export** — Generates a character-level diff for the side-by-side viewer and rebuilds the original file format (`.docx`, `.xlsx`, `.pdf`, `.csv`) in-browser with redacted content.

---

## How the Solution Works

### Architecture

```
User Input (paste / file drop)
        │
        ▼
  File Router (format detection)
        │
   ┌────┴────┐
   │ Parsers │  txt · md · csv · docx · xlsx · pdf (text + OCR)
   └────┬────┘
        │  raw text + position map
        ▼
  Pattern Engine  ──►  10+ PII regex patterns (ReDoS-safe)
        │
        ▼
  Validator Layer ──►  Luhn · Verhoeff · PAN · libphonenumber · IBAN
        │
        ▼
  Overlap Resolver ──►  longest-span-wins, offset-safe
        │
        ▼
  Mode Operator ──►  Mask / Pseudonym / Tag / Blank
        │
   ┌────┴────┐
   │ Output  │  Diff viewer · Format rebuilder · ZIP export · Restore
   └─────────┘

All steps run inside the browser. Zero network calls. CSP enforced.
```

### Key Features

| Feature | Detail |
|---|---|
| **10 PII Categories** | Email, Phone, IPv4/IPv6, PAN, Aadhaar, Credit Card, SSN, IBAN, DOB, Custom Regex |
| **5 File Formats** | `.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf` (text + scanned OCR) |
| **5 Redaction Modes** | Full Mask, Partial Mask, Consistent Pseudonymization, Category Tag, Blank |
| **Batch Processing** | Up to 10 files with shared pseudonym state → ZIP export |
| **Reversible Restore** | `.mapping.csv` export → local in-browser document restoration |
| **Live Diff Viewer** | Side-by-side original vs. sanitized with PII highlights and badges |
| **Audit Panel** | Entity counts, Luhn/Verhoeff rejection stats, pseudonym map |
| **Accessibility** | WCAG 2.1 AA, semantic landmarks, `aria-live`, `prefers-reduced-motion` |
| **Zero Egress** | Strict CSP: `default-src 'self'; connect-src 'self'` — no external calls |

---

## Assumptions Made

1. **Browser-only scope:** No server-side processing is needed or desirable. All intelligence fits within a modern browser's JS/WASM runtime.
2. **English-language OCR:** Self-hosted Tesseract English traineddata covers the target use case; additional language packs would increase bundle size.
3. **Indian PII focus with international support:** Indian formats (PAN, Aadhaar, `+91` phone) are first-class; US SSN, IBAN, and international phones are also covered.
4. **Non-Luhn numbers are intentionally left unredacted:** 16-digit order/tracking IDs that fail the Luhn check are reported as rejected candidates in the audit panel rather than silently redacted.
5. **PDF export is text-only:** Redacted PDF export reconstructs pages from text coordinates. Original images, graphics, and embedded objects are not preserved (privacy trade-off: no original pixel data leaks through).
6. **Single-branch repository:** All work is on `main` as required by the submission rules.

---

## Evaluation Criteria Coverage

| Criterion | Implementation |
|---|---|
| **Code Quality** | Strict TypeScript 5 (`noImplicitAny`, `strictNullChecks`), ESLint 0 warnings, modular architecture (parsers / validators / redactors / UI split), no `any` casts in production code |
| **Security** | Strict CSP (`default-src 'self'`), XSS-inert JSX rendering (no `innerHTML`/`dangerouslySetInnerHTML`), all assets self-hosted, ReDoS-safe regex patterns, no secrets or env vars required |
| **Efficiency** | Web Worker offloading for heavy OCR/PDF tasks, ReDoS-bounded regex, linear-time overlap resolver, lazy chunk splitting (Vite), font subsetting via `fontkit` |
| **Testing** | **167 tests / 29 files** — unit tests for every validator (Luhn, Verhoeff, PAN, IBAN, phone, overlap resolver), format round-trips (txt/csv/docx/xlsx/pdf), and full UI integration (redaction modes, theme, XSS, accessibility) |
| **Accessibility** | WCAG 2.1 AA colour contrast, semantic HTML landmarks, keyboard navigation, `aria-live="polite"` for entity counts, `prefers-reduced-motion` support |
| **Problem Alignment** | Directly addresses secure PII sanitization: smart multi-category detection, context-aware validation, 5 practical redaction modes, real-world file format support |

---

## Running Locally

```bash
git clone https://github.com/ypatil2006-coder/Detect-The-Pii.git
cd Detect-The-Pii
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm test           # 167 tests across 29 files (Vitest)
npx tsc --noEmit   # TypeScript strict check
npm run lint       # ESLint (0 errors / 0 warnings)
npm run build      # Production build → dist/
```

---

## Deployment

### Vercel (Live)

**Live URL:** https://detect-the-pii.vercel.app

Import the repository at [vercel.com/new](https://vercel.com/new). `vercel.json` auto-configures the build, CSP headers, asset caching, and SPA rewrite.

### Docker / Cloud Run (Parity)

```bash
docker build -t detect-the-pii .
docker run -d --rm -p 8080:8080 detect-the-pii
curl http://localhost:8080/healthz   # → ok
```

```bash
# Cloud Run
gcloud run deploy detect-the-pii \
  --source . --region us-central1 \
  --port 8080 --allow-unauthenticated
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript 5 |
| Build | Vite 6 |
| Testing | Vitest 3 + React Testing Library |
| PDF | pdfjs-dist (text) + pdf-lib + fontkit (rebuild) |
| OCR | Tesseract.js (self-hosted WASM + English traineddata) |
| Office Formats | jszip (docx/xlsx parsing & rebuild) |
| Phone Validation | libphonenumber-js |
| Styling | CSS custom properties (dark/light theme, `prefers-reduced-motion`) |
| Deployment | Vercel (primary) + Docker/nginx (Cloud Run parity) |
