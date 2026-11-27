# Prompt Log — Client-Side Browser PII Data Sanitizer

Chronological record of requirements analysis, architecture planning, implementation phases, and verification steps.

---

## 1. Requirements & Evaluation Criteria Alignment

- **Prompt / Goal:** Build a 100% client-side browser-based PII data sanitization tool for PromptWars x NIAT Pune, deployable on Google Cloud Run (`$PORT=8080`) with zero server-side transmission of user data.
- **Key Constraints Derived from `criteria.md`:**
  - Strict client-side processing (`File.text()` / `Blob` export, `connect-src 'none'` CSP, zero external API calls).
  - Support raw text input, `.txt`, and `.csv` files (avoiding unnecessary binary/PDF/OCR dependencies).
  - Detect and validate 6 PII categories: Email, Phone (`+91`/10-digit Indian & international), IPv4 (`0–255` octets) & IPv6, Indian PAN (`[A-Z]{5}[0-9]{4}[A-Z]` + 4th-char entity code), Indian Aadhaar (12-digit + Verhoeff checksum), and Credit Card (13–19 digits + Luhn mod-10 checksum).
  - Provide 3 redaction modes: Full Mask, Partial Mask, and Consistent Pseudonymization (`USER_01`, `CARD_01`, etc. deterministic across lines and CSV rows).
  - Deliver live side-by-side diff view, entity detection counts (including Luhn/Verhoeff rejection counts), 1-click noisy sample loader, 1-click download, WCAG 2.1 AA accessibility, XSS-safe DOM rendering, and `PROMPT_LOG.md`.

---

## 2. Implementation Plan & Modular Architecture

- **Design Decisions:**
  - **Phase 1 (Shared Contract):** Initialize Vite + React 19 + TypeScript 5 (strict) + Vitest + ESLint toolchain and lock core types (`PiiType`, `RedactionMode`, `PiiMatch`, `DetectionStats`, `PseudonymMapEntry`, `SanitizeResult`, `DiffRow`, `SanitizeFn`, `PseudonymState`) in `src/core/types.ts`.
  - **Phase 2A (Core Engine):**
    - `src/core/validators.ts`: Luhn mod-10, Verhoeff checksum, PAN entity-letter check, strict IPv4/IPv6 validators, email/phone validators, and value normalizer for pseudonymization.
    - `src/core/detector.ts`: Linear-time regex scanning, validator filtering, rejection counting (`rejectedCreditCards`, `rejectedAadhaar`), and deterministic longest-match overlap resolution.
    - `src/core/redactor.ts` & `src/core/diff.ts`: Full/Partial/Pseudonym formatting with shared `PseudonymState` and line-aligned diff row generation.
  - **Phase 2B (Format Handlers & Cloud Run Packaging):**
    - `src/formats/txt.ts` & `src/formats/csv.ts`: Client-side `.txt`/`.csv` upload validation, download filename builder, RFC-4180 CSV parser/serializer, and cross-row consistent pseudonymization via dependency-injected `SanitizeFn`.
    - `src/formats/samples.ts`: Synthetic noisy datasets (support log, clinical/resume notes, customer CSV) including intentional non-Luhn 16-digit order IDs and recurring entities.
    - `Dockerfile`, `.dockerignore`, `nginx.conf`, `cloudbuild.yaml`: Multi-stage `node:22-alpine` build served by non-root `nginxinc/nginx-unprivileged:alpine` on port `8080` with `/healthz`, gzip compression, and strict `connect-src 'none'` CSP + security headers.
  - **Phase 3 (Integration & Web Worker Pipeline):**
    - `src/core/pipeline.ts` & `src/core/worker.ts`: Unified pipeline wiring core engine and format handlers with Web Worker offloading (graceful synchronous fallback when `Worker` is unavailable).
  - **Phase 4 (Accessible UI):**
    - React UI with semantic landmarks, keyboard navigation, `aria-live="polite"` audit summary, 3-mode switcher, side-by-side diff viewer, 1-click sample loader, 1-click download, and prompt log viewer.

---

## 3. Execution & Verification Log

- **Phase 2B (Cloud Run Packaging & Documentation):**
  - Created `Dockerfile`, `.dockerignore`, `nginx.conf`, `cloudbuild.yaml`, `README.md`, and `PROMPT_LOG.md` configured for unprivileged Cloud Run serving on port `8080` with strict `connect-src 'none'` CSP.
- *(Subsequent entries for Core Engine TDD, Format Handlers TDD, Pipeline Integration, UI Verification, Container Smoke Test, and Live Cloud Run Deploy will be appended upon completion of each gate.)*
