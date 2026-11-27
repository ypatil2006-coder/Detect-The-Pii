# Client-Side Browser PII Data Sanitizer

A 100% browser-based, zero-egress Personally Identifiable Information (PII) detection, validation, redaction, and audit tool built for the **PromptWars x NIAT Pune (Google for Developers x H2S — Build with AI)** hackathon.

## Problem Alignment & Privacy Guarantee

Sensitive logs, support tickets, clinical notes, and CSV exports frequently contain PII that cannot safely be uploaded to third-party APIs or external backends. This tool performs **all parsing, validation, redaction, diffing, and file export locally inside the browser**:

- **Zero Network Egress:** Enforced via strict Content Security Policy (`connect-src 'none'`), static asset serving, and client-side `File.text()` / `Blob` APIs. Remote server-side DLP or LLM APIs are intentionally excluded so user data never leaves the device.
- **XSS-Safe Rendering:** User text and CSV cells are rendered strictly as text nodes (never via `innerHTML` or `dangerouslySetInnerHTML`).
- **Linear-Time Scanning:** Detection regexes are bounded and non-backtracking (ReDoS-safe), with Web Worker offloading for large files.

## Supported PII Categories & Validators

| Category | Detection & Validation Rules |
|---|---|
| **Email** | Practical RFC-aligned email detection with boundary guards (no false positives on handles or version tags) |
| **Phone** | Indian (`+91`, `0`-prefixed, 10-digit `6–9XXXXXXXX`) and international phone formats; rejects timestamps/short IDs |
| **IPv4 & IPv6** | Strict `0–255` octet validation for IPv4 (ignores version numbers like `v1.2.3.4` and invalid octets like `999.168.1.1`) plus IPv6 validation (excludes MAC addresses/times) |
| **Indian PAN** | `[A-Z]{5}[0-9]{4}[A-Z]` with 4th-character entity type validation (`P, C, H, A, B, G, J, L, F, T`) |
| **Indian Aadhaar** | 12-digit (`XXXX XXXX XXXX`, `XXXX-XXXX-XXXX`, compact; leading digit `2–9`) + **Verhoeff checksum validation** |
| **Credit Card** | 13–19 digit card formats + **Luhn mod-10 validation** (non-Luhn 16-digit order/tracking IDs are tracked as rejected candidates and left unredacted) |

Overlapping candidates are resolved deterministically by longest/most specific valid span without corrupting character offsets.

## Three Redaction Modes

1. **Full Mask:** Replaces every detected entity with `[REDACTED]`.
2. **Partial Mask:** Preserves verification context (`XXXX-XXXX-XXXX-1111` for cards, `XXXX-XXXX-1234` for Aadhaar, `r***@acme.com` for emails, `AB***1234F` for PAN, `192.168.***.***` for IPs, `+91-XXXXXX3210` for phones).
3. **Consistent Pseudonymization:** Maps normalized entities deterministically across lines and CSV rows (`USER_01`, `PHONE_01`, `IP_01`, `PAN_01`, `AADHAAR_01`, `CARD_01`) so recurring entities remain linkable without exposing raw PII.

## Key Features

- Raw text paste editor plus client-side `.txt` and RFC-4180 `.csv` upload/export
- 1-click noisy sample dataset presets (support logs, clinical/resume notes, customer CSV)
- Live side-by-side diff viewer (Original with color+badge PII highlights vs. Sanitized output)
- Real-time entity detection counts and Luhn/Verhoeff rejection counters (`aria-live="polite"`)
- Accessible, keyboard-navigable UI (WCAG 2.1 AA contrast, semantic landmarks, `prefers-reduced-motion`)

## Local Development & Testing

```bash
npm install
npm run dev      # Start Vite dev server
npm test         # Run unit & integration tests (Vitest)
npm run lint     # Run ESLint checks
npm run build    # Typecheck & build production dist/
```

## Docker & Google Cloud Run Deployment

The production image uses a multi-stage build (`node:22-alpine` -> unprivileged `nginxinc/nginx-unprivileged:alpine`) listening on `$PORT=8080` with `/healthz` health checks and strict CSP headers.

### Local Container Smoke Test

```bash
docker build -t pii-sanitizer .
docker run -d --rm -p 8080:8080 --name pii-check pii-sanitizer
curl -i http://localhost:8080/healthz
curl -I http://localhost:8080/
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
