# PromptWars × NIAT Pune (Google for Developers × H2S — Build with AI) — Evaluation Criteria & Checkpoints

**Workspace:** `/home/yash/Projects/Hackathons/PromptWars-NIAT-Pune`  
**Problem Statement:** Client-Side Browser-Based PII Data Sanitization Tool  
**Judging Mode:** Automated AI Platform Code Assessment + Live Cloud Run Deployment Check

---

## Non-Negotiable Rules & Disqualification Gates

- [ ] **Live Google Cloud Run Deployment Works:** Top 10 requires *both* a Top 10 leaderboard score *and* a live, working Google Cloud Run URL. A broken deployed link results in immediate **DQ** even if ranked in Top 10.
- [ ] **Final Submission Only Counts:** Only the **final submission** score for the phase is counted (not the best attempt). Never push an untested/unverified commit as the final submission.
- [ ] **100% Client-Side PII Processing:** Raw text, `.txt`/`.csv` file contents, and detected PII must **never** leave the browser or be sent to any external server/API.

---

## 1. Problem Statement Alignment Checkpoints

### Input & File Handling
- [ ] Paste raw text directly into the editor/input area (text logs, resumes, support tickets, clinical notes).
- [ ] Upload `.txt` and `.csv` files entirely client-side via the browser `FileReader` / `File.text()` API (no server upload endpoint).
- [ ] Validate file type/extension and handle empty, malformed, or large files gracefully.
- [ ] **1-Click Sample Noisy Text Loader** with realistic multi-entity test data (emails, phones, IPs, valid + invalid credit cards, Indian PAN & Aadhaar, recurring entities across multiple lines, CSV/log samples).

### Pattern Detection & Validation Logic
- [ ] **Emails:** Accurate RFC-practical email detection without false positives on version strings or handles.
- [ ] **Phone Numbers:** Detect international and Indian formats (`+91`, `0`-prefixed, 10-digit mobile `6–9XXXXXXXX`, spaced/hyphenated formats) without falsely flagging random timestamps/IDs.
- [ ] **IP Addresses:** IPv4 (octet range `0–255` validated, not just `\d+\.\d+\.\d+\.\d+` matching version numbers like `999.0.0.1`) and IPv6 detection.
- [ ] **Indian PAN Format:** Strict `[A-Z]{5}[0-9]{4}[A-Z]` pattern + 4th-character entity-type validation (`P, C, H, A, B, G, J, L, F, T`).
- [ ] **Indian Aadhaar Format:** 12-digit (`XXXX XXXX XXXX` / `XXXX-XXXX-XXXX` / `XXXXXXXXXXXX`, first digit `2–9`) + **Verhoeff checksum validation** (or strict false-positive guard) so random 12-digit numbers aren't misclassified.
- [ ] **Credit Card Numbers + Luhn Algorithm:** Detect 13–19 digit card patterns (spaces/hyphens allowed) and enforce **Luhn mod-10 validation** so random 16-digit numeric strings are **not** flagged as credit cards.
- [ ] Overlap resolution: deterministic precedence/span merging so overlapping matches never corrupt offsets or double-redact.

### Three Redaction Modes
- [ ] **Full Mask:** Replace sensitive text with fixed blocks (e.g., `[REDACTED]` or typed `[REDACTED_EMAIL]`, `[REDACTED]`).
- [ ] **Partial Mask:** Retain partial verification context (e.g., `XXXX-XXXX-1234` for cards/Aadhaar, `j***@example.com` for emails, `AB***1234F` for PAN, `192.168.***.***` for IPs, `+91-XXXXXX3210` for phones).
- [ ] **Consistent Pseudonymization:** Maintain deterministic per-session/per-document mapping so identical entities map to the exact same placeholder throughout the document (e.g., `alice@acme.com` → `EMAIL_01` or `USER_01` everywhere it recurs, `bob@acme.com` → `EMAIL_02` / `USER_02`).

### Audit, Diff View, Export & Deliverables
- [ ] **Live Side-by-Side Diff View:** Synchronized Original (with color-coded inline PII highlights by entity type) vs. Sanitized output (highlighting redacted/pseudonymized spans).
- [ ] **Entity Detection Counts:** Live breakdown of total entities detected, count per category (Email, Phone, IP, PAN, Aadhaar, Credit Card), plus Luhn-rejected / false-positive count if helpful.
- [ ] **1-Click Download:** Export sanitized output as `.txt` or `.csv` (matching input format or selectable) via client-side `Blob` + `URL.createObjectURL`.
- [ ] **Prompt Log Deliverable:** Include a clean, complete `PROMPT_LOG.md` (and/or in-repo prompt log) documenting the prompts, iterations, and verification steps used to build the tool.

---

## 2. Code Quality Checkpoints

- [ ] Clean modular architecture separating detection/validation engine (`src/engine/`), redaction modes, diff/highlighting utilities, file parser, and UI components.
- [ ] Strict TypeScript (or clean JSDoc-typed JS) with zero `any` abuse, zero unused imports/variables, and zero dead code.
- [ ] ESLint / formatter configured and passing with zero errors/warnings.
- [ ] Clear `README.md` explaining architecture, client-side privacy guarantee, local run, tests, and Cloud Run deployment.

---

## 3. Security Practices Checkpoints

- [ ] **Zero Network Egress for User Data:** Strict Content Security Policy (`CSP`) in `index.html` / `nginx.conf` (e.g., `default-src 'self'; connect-src 'none'` or `'self'` only—proving no PII can be exfiltrated via `fetch`/`XHR`/WebSockets).
- [ ] **XSS Prevention:** Never render user-provided raw text or CSV cells via `innerHTML` / `dangerouslySetInnerHTML`; always render safely via DOM `textContent` or React JSX text nodes.
- [ ] **Safe Regexes (No ReDoS):** All detection regexes must run in linear time with no catastrophic backtracking on adversarial input.
- [ ] **Client-Side Upload Guardrails:** Enforce safe file extension checks (`.txt`, `.csv`) and reasonable file-size limits with clear error handling.
- [ ] **Security Headers in Container:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` in Cloud Run web server config.
- [ ] **Non-Root Container:** `Dockerfile` runs as an unprivileged user (e.g., non-root `nginx` or static server) with minimal attack surface.

---

## 4. Efficiency Checkpoints

- [ ] Fast linear-time scanning across large logs/CSVs (sub-50ms on typical documents; chunked or Web Worker processing for multi-MB `.txt`/`.csv` files so the UI never freezes).
- [ ] Debounced/memoized live updates while typing so keystrokes stay at 60fps.
- [ ] Lightweight production bundle (minimal runtime dependencies, tree-shaken build, gzip/brotli enabled in Cloud Run server, multi-stage `Dockerfile` for small image & fast cold starts).

---

## 5. Testing Checkpoints

- [ ] **Unit Tests for Every Pattern & Validator:**
  - Valid & invalid Luhn credit card numbers (confirming random 16-digit strings fail Luhn and are NOT redacted).
  - Indian PAN (valid formats + invalid 4th-char/lowercase/malformed edge cases).
  - Indian Aadhaar (12-digit spaced/hyphenated/compact + Verhoeff checksum validation).
  - IPv4 (valid IPs vs. invalid `999.999.1.1` or version numbers `v1.2.3.4`) and IPv6.
  - Emails & phone numbers (Indian `+91`, `0`-prefix, US/international, edge punctuation).
- [ ] **Unit Tests for All 3 Redaction Modes:**
  - Full Mask output assertions.
  - Partial Mask format & context preservation assertions.
  - Consistent Pseudonymization determinism (same entity → same token across lines & `.csv` rows; different entities → distinct tokens).
- [ ] **Integration / UI / File Tests:**
  - `.txt` and `.csv` parsing & download generation.
  - Side-by-side diff alignment & entity counts accuracy.
  - Security check: XSS payload in pasted text (`<script>alert(1)</script>`) renders harmlessly as text.
- [ ] All tests automated (`npm test` / `vitest`) and passing 100% before final submission.

---

## 6. Accessibility (a11y) Checkpoints

- [ ] Semantic HTML landmarks (`<header>`, `<main>`, `<section>`, `<aside>`, `<footer>`) and logical heading hierarchy (`h1` → `h2` → `h3`).
- [ ] Every control has an accessible label (`<label for=...>`, `aria-label`), including mode selector buttons/radios, file upload dropzone, sample loader, and download button.
- [ ] Keyboard-only operability (`Tab`, `Shift+Tab`, `Enter`/`Space`, visible `:focus-visible` outlines—never `outline: none` without replacement).
- [ ] `aria-live="polite"` status region announcing entity detection totals / redaction mode changes for screen readers.
- [ ] WCAG 2.1 AA color contrast (>= 4.5:1 for normal text, >= 3:1 for badges/UI elements) and do **not** rely on color alone for PII entity types (include text labels/badges/tooltips).
- [ ] Respect `prefers-reduced-motion` for any transitions.

---

## 7. Google Services Usage Checkpoints (Client-Side Compatible)

- [ ] **Google Cloud Run Deployment:** Production `Dockerfile` (listening on `$PORT`, default `8080`), `.dockerignore`, `cloudbuild.yaml` (optional CI/CD), and `/healthz` endpoint verified live on `*.run.app`.
- [ ] **Additional Google Services (Strict Zero-PII-Egress Safe):**
  - Self-hosted or Google Fonts (`Inter` / `JetBrains Mono`) / Material Symbols (note: verify CSP allows font host *only* if used, or bundle cleanly while keeping `connect-src 'none'` for zero network data transmission).
  - Optional: On-device **Google MediaPipe / TensorFlow.js** (or WebGPU local-only helper) *strictly offline/client-side* if adding optional NER boost, OR **Google Cloud Build + Artifact Registry + Cloud Run** infrastructure-as-code (`cloudbuild.yaml` + deploy script) with explicit documentation explaining why remote Cloud DLP / Gemini APIs are intentionally excluded to uphold the strict client-side zero-server-transmission constraint.

---

## 8. Final Pre-Submission Gate

- [ ] Run full automated test suite (`npm test`) — 100% passing.
- [ ] Run linter & production build (`npm run lint && npm run build`) — zero errors.
- [ ] Build & test Docker container locally on port `8080` (`docker build` + `docker run -p 8080:8080`).
- [ ] Deploy to **Google Cloud Run** and verify the live `https://...run.app` URL in a fresh browser window (Network tab shows **zero** outbound requests containing pasted/uploaded text).
- [ ] Verify `PROMPT_LOG.md` is up to date and committed.
- [ ] Confirm the **final** pushed commit / submission matches the tested & deployed build (remember: *only the final submission score is considered*).
