# Client-Side Browser PII Data Sanitizer

> **Deployment Note (Vercel & Cloud Run Rubric Clarification):** While the automated hackathon rubric (`criteria.md`) still lists its default Google Cloud Run gate, the organizers confirmed that participants may deploy on any platform because Google Cloud tokens/credits were not provided. This submission deploys completely on **Vercel** (`vercel.json` + static Vite `dist/` bundle with zero serverless egress), while retaining full locally tested Docker / Cloud Run parity (`Dockerfile`, `nginx.conf`, `cloudbuild.yaml`, `$PORT=8080`, `/healthz`).

A 100% browser-based, zero-external-egress Personally Identifiable Information (PII) detection, validation, redaction, and restoration tool built for the **PromptWars × NIAT Pune (Google for Developers × H2S — Build with AI)** hackathon.

## Problem Alignment & Zero-Egress Privacy Guarantee

Sensitive logs, support tickets, clinical notes, spreadsheets, Word files, and PDFs frequently contain PII that cannot safely be uploaded to third-party APIs or external backends. This tool executes **all parsing, OCR, validation, redaction, diffing, restoration, and export locally inside the browser**:

- **Zero External Network Egress:** Enforced via strict Content Security Policy (`default-src 'self'; connect-src 'self'; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'`). All `pdfjs-dist` workers, `tesseract.js` WASM/worker/English traineddata assets, and embedded PDF fonts (`public/fonts/NotoSansTC-Regular.ttf`) are self-hosted inside the container—remote Cloud DLP, LLM, and CDN requests are intentionally excluded.
- **True PDF Re-Generation (No Hidden Text Leaks):** Redacted `.pdf` exports rebuild pages from text-only coordinates and sanitized text rather than drawing opaque boxes over original PDF text streams.
- **XSS-Safe Rendering:** User text, CSV cells, and extracted document previews are rendered strictly as React JSX text nodes (never `innerHTML` or `dangerouslySetInnerHTML`).
- **Linear-Time Scanning:** Built-in detection regexes are bounded and non-backtracking (ReDoS-safe), with Web Worker offloading for large text inputs.

## Supported Formats & Batch Workflow

| Format | Client-Side Processing Capabilities |
|---|---|
| **Raw Text / `.txt` / `.md`** | Paste editor or file upload via `File.text()`, BOM/CRLF normalization, live side-by-side diff, `.txt`/`.md` download |
| **`.csv`** | RFC-4180 parser/serializer preserving quoted commas, escaped quotes (`""`), and embedded newlines with cross-row pseudonym consistency |
| **`.docx`** | Client-side OOXML (`jszip`) paragraph text extraction, layout reconstruction, and in-place sanitized `.docx` rebuild |
| **`.xlsx`** | Client-side SpreadsheetML (`jszip`) workbook cell extraction (shared strings & inline strings) and sanitized `.xlsx` rebuild |
| **`.pdf` (Text & Scanned)** | Text-layer extraction via `pdfjs-dist` + automatic fallback to self-hosted English `tesseract.js` OCR for scanned image PDFs, rebuilt cleanly via `pdf-lib` + `fontkit` sparse TTF subsetting |
| **Batch + Restore** | Process up to 10 files together with shared pseudonym state, download as `.zip`, plus optional reversible `.mapping.csv` export & **Restore** mode |

## Supported PII Categories & Validators

| Category | Detection & Validation Rules |
|---|---|
| **Email** | Practical RFC-aligned email detection with boundary guards |
| **Phone** | Indian (`+91`, `0`-prefixed, 10-digit `6–9XXXXXXXX`) and international phone validation (`libphonenumber-js`); rejects timestamps/short IDs |
| **IPv4 & IPv6** | Strict `0–255` octet validation for IPv4 (ignores version tags like `v1.2.3.4` and invalid octets like `999.168.1.1`) plus IPv6 validation (excludes MAC addresses/times) |
| **Indian PAN** | `[A-Z]{5}[0-9]{4}[A-Z]` with 4th-character entity type validation (`P, C, H, A, B, G, J, L, F, T`) |
| **Indian Aadhaar** | 12-digit (`XXXX XXXX XXXX`, `XXXX-XXXX-XXXX`, compact; leading digit `2–9`) + **Verhoeff checksum validation** |
| **Credit Card** | 13–19 digit card formats + **Luhn mod-10 validation** (non-Luhn 16-digit order/tracking IDs are tracked as rejected candidates and left unredacted) |
| **SSN / IBAN / DOB / Custom** | US SSN format guards, IBAN mod-97 checksum validation, date-of-birth patterns, and user-defined custom `RegExp` rules |

Overlapping candidates are resolved deterministically by longest/most specific valid span without corrupting character offsets.

## Redaction Modes & Reversibility

1. **Full Mask:** Replaces every detected entity with `[REDACTED]`.
2. **Partial Mask:** Preserves verification context (`XXXX-XXXX-XXXX-1111` for cards, `XXXX-XXXX-1234` for Aadhaar, `r***@acme.com` for emails, `AB***1234F` for PAN, `192.168.***.***` for IPs, `+91-XXXXXX3210` for phones).
3. **Consistent Pseudonymization:** Maps normalized entities deterministically across lines, CSV rows, and batch files (`USER_01`, `PHONE_01`, `IP_01`, `PAN_01`, `AADHAAR_01`, `CARD_01`, etc.).
4. **Category / Blank / Restore:** Supports `[CATEGORY]` labels, blank redaction, and optional `.mapping.csv` export to restore sanitized documents locally in the browser.

## Key UI & Audit Features

- 1-click noisy sample dataset loader (support logs, clinical/onboarding notes, customer CSV)
- Live side-by-side diff viewer (Original with color+badge PII highlights vs. Sanitized output)
- Real-time entity detection counts and Luhn/Verhoeff rejection counters (`aria-live="polite"`)
- Custom rule manager, batch file queue (up to 10 files) + ZIP download, and local `.mapping.csv` restore
- Accessible, keyboard-navigable UI (WCAG 2.1 AA contrast, semantic landmarks, `prefers-reduced-motion`)

## Local Development & Testing

```bash
npm install
npm run dev      # Start Vite dev server (serves self-hosted /ocr/ and /fonts/)
npm test         # Run all 29 test files / 167 automated unit & integration tests (Vitest)
npm run lint     # Run ESLint checks (0 errors/warnings)
npm run build    # Typecheck (tsc --noEmit) & build production dist/
```

## Deployment Options

### 1. Vercel (Primary Deployment)

The app is a pure static Vite + React SPA (`dist/`) requiring zero serverless functions or environment secrets. [`vercel.json`](./vercel.json) enforces the same strict zero-egress CSP (`default-src 'self'; connect-src 'self'; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'`), security headers, long-lived caching for `/assets/*`, `/ocr/*`, and `/fonts/*`, and SPA route fallback.

- **GitHub Integration:** Import the repository in Vercel (`Framework Preset: Vite`, `Build Command: npm run build`, `Output Directory: dist`).
- **CLI Deploy:**

```bash
npm install -g vercel
vercel --prod
```

### 2. Docker & Google Cloud Run (Container Parity)

The container image uses a multi-stage build (`node:22-alpine` -> unprivileged `nginxinc/nginx-unprivileged:alpine`) listening on `$PORT=8080` with `/healthz` health checks, gzip compression, self-hosted `/ocr/` + `/fonts/` assets, and strict CSP headers.

### Local Container Smoke Test

```bash
docker build -t pii-sanitizer-local .
docker run -d --rm -p 8080:8080 --name pii-check pii-sanitizer-local
curl -sSf http://localhost:8080/healthz
curl -sI http://localhost:8080/
curl -sI http://localhost:8080/ocr/worker.min.js
curl -sI http://localhost:8080/ocr/lang/eng.traineddata.gz
docker stop pii-check
```

### Deploy via Cloud Build or `gcloud`

```bash
# Option 1: Cloud Build pipeline (Artifact Registry + Cloud Run)
gcloud builds submit --config cloudbuild.yaml .

# Option 2: Direct source deploy to Cloud Run
gcloud run deploy pii-sanitizer \
  --source . \
  --region us-central1 \
  --port 8080 \
  --allow-unauthenticated
```
