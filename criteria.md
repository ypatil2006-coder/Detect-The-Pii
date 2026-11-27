# PromptWars × NIAT Pune (Google for Developers × H2S — Build with AI) — Evaluation Criteria & Checkpoints

**Workspace:** `/home/yash/Projects/Hackathons/PromptWars-NIAT-Pune`  
**Problem Statement:** Client-Side Browser-Based PII Data Sanitization Tool  
**Judging Mode:** Automated AI Platform Code Assessment + Live Cloud Run Deployment Check

---

## Non-Negotiable Rules & Disqualification Gates

- [ ] **Live Google Cloud Run Deployment Works:** Top 10 requires *both* a Top 10 leaderboard score *and* a live, working Google Cloud Run URL. A broken deployed link results in immediate **DQ** even if ranked in Top 10. *(Awaiting user deploy via `gcloud builds submit` / `gcloud run deploy` — `gcloud` CLI is not installed in this local environment; local Docker parity container verified on `:8080`.)*
- [ ] **Final Submission Only Counts:** Only the **final submission** score for the phase is counted (not the best attempt). Never push an untested/unverified commit as the final submission.
- [x] **100% Client-Side PII Processing:** Raw text, uploaded documents (`.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`, scanned PDFs), and detected PII must **never** leave the browser or be sent to any external server/API.

---

## 1. Problem Statement Alignment Checkpoints

### Input & Multi-Format File Handling
- [x] Paste raw text directly into the editor/input area (text logs, resumes, support tickets, clinical notes).
- [x] Upload `.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, and `.pdf` (both text-layer and scanned image PDFs via self-hosted client-side English OCR) using browser File APIs (`File.text()` / `File.arrayBuffer()`) with zero server upload endpoints.
- [x] Batch process up to 10 files in one session with consistent cross-file mapping and ZIP archive export (`jszip`).
- [x] Validate file types/extensions and handle empty, malformed, password/scan-empty, or oversized files gracefully.
- [x] **1-Click Sample Noisy Text Loader** with realistic multi-entity test data (emails, phones, IPs, valid + invalid credit cards, Indian PAN & Aadhaar, SSN/IBAN/DOB, recurring entities across multiple lines, CSV/log samples).

### Pattern Detection & Validation Logic
- [x] **Emails:** Accurate RFC-practical email detection without false positives on version strings or handles.
- [x] **Phone Numbers:** Detect international and Indian formats (`+91`, `0`-prefixed, 10-digit mobile `6–9XXXXXXXX`, `libphonenumber-js` validation, spaced/hyphenated formats) without falsely flagging random timestamps/IDs.
- [x] **IP Addresses:** IPv4 (octet range `0–255` validated, not `\d+\.\d+\.\d+\.\d+` matching version numbers like `v1.2.3.4` or `999.0.0.1`) and IPv6 detection (excluding MACs/times).
- [x] **Indian PAN Format:** Strict `[A-Z]{5}[0-9]{4}[A-Z]` pattern + 4th-character entity-type validation (`P, C, H, A, B, G, J, L, F, T`).
- [x] **Indian Aadhaar Format:** 12-digit (`XXXX XXXX XXXX` / `XXXX-XXXX-XXXX` / `XXXXXXXXXXXX`, first digit `2–9`) + **Verhoeff checksum validation** so random 12-digit numbers aren't misclassified.
- [x] **Credit Card Numbers + Luhn Algorithm:** Detect 13–19 digit card patterns (spaces/hyphens allowed) and enforce **Luhn mod-10 validation** so random 16-digit numeric strings are **not** flagged as credit cards.
- [x] **Extended Identity & Custom Rules:** Support `SSN`, `IBAN` (mod-97 validation), `DOB`, and user-defined custom `RegExp` rules.
- [x] Overlap resolution: deterministic precedence/span merging so overlapping matches never corrupt offsets or double-redact.

### Redaction Modes & Reversibility
- [x] **Full Mask:** Replace sensitive text with fixed blocks (`[REDACTED]` / block mask).
- [x] **Partial Mask:** Retain partial verification context (`XXXX-XXXX-1111` for cards, `XXXX-XXXX-1234` for Aadhaar, `j***@example.com` for emails, `AB***1234F` for PAN, `192.168.***.***` for IPs, `+91-XXXXXX3210` for phones).
- [x] **Consistent Pseudonymization:** Maintain deterministic per-session/per-document mapping so identical entities map to the exact same placeholder throughout the document and across CSV/batch files (`USER_01`, `PHONE_01`, `CARD_01`, etc.).
- [x] **Category / Blank / Reversible Mapping Restore:** Support `[CATEGORY]` / blank markers and optional `.mapping.csv` export + client-side **Restore** workflow to recover original values locally when authorized.

### Audit, Diff View, Export & Deliverables
- [x] **Live Side-by-Side Diff View:** Synchronized Original (with color-coded inline PII highlights by entity type) vs. Sanitized output (highlighting redacted/pseudonymized spans).
- [x] **Entity Detection Counts:** Live breakdown of total entities detected, count per category, plus Luhn-rejected / Aadhaar-rejected false-positive counts.
- [x] **1-Click Download:** Export sanitized output (`.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`, `.zip`, plus optional `.mapping.csv`) via client-side `Blob` + `URL.createObjectURL`.
- [x] **Prompt Log Deliverable:** Include a clean, complete `PROMPT_LOG.md` documenting the prompts, iterations, and verification steps used to build the tool.

---

## 2. Code Quality Checkpoints

- [x] Clean modular architecture separating detection/validation engine (`src/core/`), format parsers/generators (`src/formats/`), and UI components (`src/ui/`).
- [x] Strict TypeScript with zero `any` abuse, zero unused imports/variables, and zero dead code.
- [x] ESLint / formatter configured and passing with zero errors/warnings.
- [x] Clear `README.md` explaining architecture, client-side privacy guarantee, multi-format + OCR support, local run, tests, and Cloud Run deployment.

---

## 3. Security Practices Checkpoints

- [x] **Zero External Network Egress for User Data:** Strict Content Security Policy (`CSP`) in `index.html` / `nginx.conf` (`default-src 'self'; connect-src 'self'; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'`), serving all OCR WASM/worker/language assets locally from the container with zero third-party or CDN calls.
- [x] **XSS Prevention:** Never render user-provided raw text or document cells via `innerHTML` / `dangerouslySetInnerHTML`; always render safely via React JSX text nodes.
- [x] **Safe Regexes (No ReDoS):** All detection regexes run in linear time with no catastrophic backtracking on adversarial input; custom user RegExp patterns are guarded.
- [x] **PDF Redaction Integrity:** Rebuilt `.pdf` outputs draw only sanitized text/layout primitives (never copying raw underlying PDF text objects underneath black boxes).
- [x] **Client-Side Upload Guardrails:** Enforce safe file extension checks (`.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`), batch limits (max 10 files), and file-size guardrails with clear error handling.
- [x] **Security Headers in Container:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` in Cloud Run web server config.
- [x] **Non-Root Container:** `Dockerfile` runs as an unprivileged user (`nginx`) on port `8080`.

---

## 4. Efficiency Checkpoints

- [x] Fast linear-time scanning across large logs/CSVs (sub-50ms on typical documents; Web Worker offloading for large text payloads, self-hosted OCR/PDF workers).
- [x] Debounced/memoized live updates while typing so keystrokes stay responsive.
- [x] Lightweight Cloud Run container (`node:22-alpine` build -> `nginxinc/nginx-unprivileged:alpine`, gzip enabled, English-only self-hosted OCR weights).

---

## 5. Testing Checkpoints

- [x] **Unit Tests for Every Pattern & Validator:**
  - Valid & invalid Luhn credit card numbers (confirming random 16-digit strings fail Luhn and are NOT redacted).
  - Indian PAN (valid formats + invalid 4th-char/lowercase/malformed edge cases).
  - Indian Aadhaar (12-digit spaced/hyphenated/compact + Verhoeff checksum validation).
  - IPv4 (valid IPs vs. invalid `999.999.1.1` or version numbers `v1.2.3.4`) and IPv6.
  - Emails, phones (`+91`, `0`-prefix, US/intl via `libphonenumber-js`), SSN, IBAN, DOB, and custom RegExp rules.
- [x] **Unit Tests for Redaction, Mapping & Formats:**
  - Full Mask, Partial Mask, Consistent Pseudonymization, Category/Blank markers, and `.mapping.csv` Restore round-trip.
  - `.txt`/`.md`, RFC-4180 `.csv`, `.docx`, `.xlsx`, `.pdf` (including layout/subsetting & OCR pipelines), and batch ZIP export.
- [x] **Integration / UI / Security Tests:**
  - End-to-end pipeline across sample datasets and multi-format round-trips.
  - Side-by-side diff alignment & entity counts accuracy.
  - Security check: XSS payload in pasted text (`<script>alert(1)</script>`) renders harmlessly as text.
- [x] All tests automated (`npm test` / `vitest`) and passing 100% before final submission.

---

## 6. Accessibility (a11y) Checkpoints

- [x] Semantic HTML landmarks (`<header>`, `<main>`, `<section>`, `<aside>`, `<footer>`) and logical heading hierarchy (`h1` → `h2` → `h3`).
- [x] Every control has an accessible label (`<label for=...>`, `aria-label`), including mode selector buttons/radios, file upload dropzone, sample loader, and download button.
- [x] Keyboard-only operability (`Tab`, `Shift+Tab`, `Enter`/`Space`, visible `:focus-visible` outlines—never `outline: none` without replacement).
- [x] `aria-live="polite"` status region announcing entity detection totals / redaction mode changes for screen readers.
- [x] WCAG 2.1 AA color contrast (>= 4.5:1 for normal text, >= 3:1 for badges/UI elements) and do **not** rely on color alone for PII entity types (include text labels/badges/tooltips).
- [x] Respect `prefers-reduced-motion` for any transitions.

---

## 7. Google Services Usage Checkpoints (Client-Side Compatible)

- [ ] **Google Cloud Run Deployment:** Production `Dockerfile` (listening on `$PORT`, default `8080`), `.dockerignore`, `cloudbuild.yaml`, and `/healthz` endpoint verified live on `*.run.app`. *(Container & `/healthz` verified locally on `:8080`; live `*.run.app` deploy pending `gcloud` auth.)*
- [x] **Google Cloud Build + Artifact Registry + Cloud Run:** Infrastructure-as-code (`cloudbuild.yaml`) with explicit documentation explaining why remote Cloud DLP / Gemini APIs are intentionally excluded to uphold the strict client-side zero-server-transmission constraint.

---

## 8. Final Pre-Submission Gate

- [x] Run full automated test suite (`npm test`) — 100% passing.
- [x] Run linter & production build (`npm run lint && npm run build`) — zero errors.
- [x] Build & test Docker container locally on port `8080` (`docker build` + `docker run -p 8080:8080`).
- [ ] Deploy to **Google Cloud Run** and verify the live `https://...run.app` URL in a fresh browser window (Network tab shows **zero** outbound requests to external hosts or containing user data).
- [x] Verify `PROMPT_LOG.md` is up to date and committed.
- [ ] Confirm the **final** pushed commit / submission matches the tested & deployed build (remember: *only the final submission score is considered*).
