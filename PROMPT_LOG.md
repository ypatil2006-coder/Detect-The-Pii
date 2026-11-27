# Prompt Log — Client-Side Browser PII Data Sanitizer

Chronological record of requirements analysis, architecture planning, multi-format expansion, UI verification, container hardening, and verification gates.

---

## 1. Requirements & Evaluation Criteria Alignment

- **Prompt / Goal:** Build a 100% client-side browser-based PII data sanitization tool for PromptWars × NIAT Pune (Google for Developers × H2S — Build with AI), deployable on Google Cloud Run (`$PORT=8080`) with zero external transmission of user data.
- **Core Checkpoints (`criteria.md`):**
  - Strict client-side processing (`File.text()` / `File.arrayBuffer()` / `Blob` export, self-hosted assets only, zero external API calls).
  - Multi-format support: raw text, `.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf` (text-layer + scanned PDF English OCR via self-hosted `pdfjs-dist` + `tesseract.js`), plus batch processing (up to 10 files + ZIP export via `jszip`).
  - Detect and validate built-in & custom PII categories: Email, Phone (`+91`/10-digit Indian & international via `libphonenumber-js`), IPv4 (`0–255` octets) & IPv6, Indian PAN (`[A-Z]{5}[0-9]{4}[A-Z]` + 4th-char entity code), Indian Aadhaar (12-digit + Verhoeff checksum), Credit Card (13–19 digits + Luhn mod-10 checksum), SSN, IBAN (mod-97), DOB, and user-defined custom `RegExp` rules.
  - Redaction & Reversibility: Full Mask, Partial Mask, Consistent Pseudonymization (`USER_01`, `CARD_01`, etc. deterministic across lines, CSV rows, and batch files), Category Tag (`[EMAIL]`), Blank Placeholder (`○○○`), and reversible `.mapping.csv` export + local Restore workflow.
  - Deliverables: Live side-by-side diff view, entity detection & rejection counts, 1-click noisy sample loader, 1-click download, WCAG 2.1 AA accessibility, XSS-safe React JSX rendering, and `PROMPT_LOG.md`.

---

## 2. Implementation Plan & Modular Architecture

- **Phase 1 (Shared Contract):**
  - Initialized Vite 6 + React 19 + TypeScript 5 (strict) + Vitest 3 + ESLint 9 toolchain and locked core interfaces in `src/core/types.ts`.
- **Phase 2A (Core Engine):**
  - `src/core/validators.ts`: Luhn mod-10, Verhoeff checksum, PAN entity-letter check, strict IPv4/IPv6 validators, email/phone (`libphonenumber-js`) validators, ISO 7064 mod-97 IBAN, SSN, DOB, and entity normalizer.
  - `src/core/detector.ts`: Linear-time regex scanning, validator filtering, rejection counting (`rejectedCreditCards`, `rejectedAadhaar`), custom `RegExp` rules, manual span additions, and deterministic longest-match overlap resolution.
  - `src/core/redactor.ts`, `src/core/codes.ts`, `src/core/mask.ts`, `src/core/retention.ts`, `src/core/diff.ts`, `src/core/restorer.ts`: Full/Partial/Pseudonym/Category/Blank formatting with shared `PseudonymState`, `CodeBook`, partial retention splits, `.mapping.csv` generation & local Restore, and line-aligned diff row generation.
- **Phase 2B (Format Handlers & Cloud Run Packaging):**
  - `src/formats/txt.ts`, `src/formats/plaintext.ts`, `src/formats/csv.ts`: Client-side file validation, `jsdom`/browser `readBlobBytes`/`readBlobText` wrappers, download filename builder, RFC-4180 CSV parser/serializer, `.mapping.csv` serializer/parser, and cross-row consistent pseudonymization.
  - `src/formats/docx.ts`, `src/formats/xlsx.ts`, `src/formats/pdf.ts`, `src/formats/ttf-subset.ts`, `src/formats/layout-scan.ts`, `src/formats/ocr.ts`, `src/formats/batch.ts`, `src/formats/index.ts`: Pure browser parsers/rebuilders for Office OOXML, SpreadsheetML (with orphaned `sharedStrings.xml` scrubbing), text-layer & scanned English OCR PDFs (with sparse TrueType subsetting of `public/fonts/NotoSansTC-Regular.ttf` and self-hosted `dist/ocr/` assets), plus up-to-10-file batch ZIP packaging.
  - `src/formats/samples.ts`: Synthetic noisy datasets (`support-log`, `clinical-resume`, `customers-csv`, plus Markdown/DOCX/XLSX/PDF sample builders) including intentional non-Luhn 16-digit order IDs and recurring entities.
  - `Dockerfile`, `.dockerignore`, `nginx.conf`, `cloudbuild.yaml`: Multi-stage `node:22-alpine` build served by non-root `nginxinc/nginx-unprivileged:alpine` on port `8080` with `/healthz`, gzip compression, self-hosted `/ocr/` and `/fonts/` serving, and strict CSP (`default-src 'self'; connect-src 'self'; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'`).
- **Phase 3 (Integration & Web Worker Pipeline):**
  - `src/core/pipeline.ts`, `src/core/document-pipeline.ts`, `src/core/worker.ts`: Unified multi-format pipeline (`analyzeDocument`, `recomputeDocumentSession`, `buildExportBlob`) with real sub-ms `PipelineStageTiming` telemetry and Web Worker offloading with synchronous fallback.
- **Phase 4 (Accessible UI & Synchronized Motion):**
  - Built against the 4 layout/interaction reference views (`LandingComposer`, `Sidebar`, `AuditPanel`, `PipelineFlow` synchronized `requestAnimationFrame` timeline with Play/Pause/Step/Replay controls, `ProgressChecklist`, `DiffSuggestionsView` with 5-mode switcher + item/category overrides + manual add, `RulesRestorePanel`, `PromptLogModal`).
  - Enforced WCAG 2.1 AA landmarks (`<header>`, `<main>`, `<nav>`, `<aside>`), `aria-live="polite"` status announcements, `:focus-visible` outlines, non-color entity badges, `prefers-reduced-motion`, and strict JSX text rendering (zero `dangerouslySetInnerHTML`).

---

## 3. Execution & Verification Log

1. **Phases 1–3 Baseline (Commits `9d7a913` → `81fbf52`):**
   - Initialized toolchain, locked core types, built TDD-verified validators/detector/redactor/diff (`31/31` unit tests), `.txt`/`.csv`/samples/deploy configs (`13/13` unit tests), and unified pipeline (`12/12` integration tests; `56/56` total passing, `tsc` and `eslint` clean).
2. **Wave 1 Expansion — Core & Multi-Format Engine:**
   - Added `libphonenumber-js`, `jszip`, `pdf-lib`, `@pdf-lib/fontkit`, `pdfjs-dist`, `tesseract.js`, `@tesseract.js-data/eng`, `public/fonts/NotoSansTC-Regular.ttf`, and self-hosted Vite `ocrAssets()` plugin.
   - Resolved code-review fixes: non-greedy `phoneLength` tail trimming, BOM-stripped CSV diff row alignment, and restricting `buildArchive` `.mapping.csv` output strictly to reversible modes (`143/143` tests across `21` files passing).
3. **Wave 2 Integration — Multi-Format Document Pipeline:**
   - Wired `PipelineStageTiming`, `document-pipeline.ts`, `worker.ts`, and round-trip integration tests for `.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.pdf`, retention, batch ZIP, and English samples (`160/160` tests across `28` files passing).
4. **Phase 4 UI Build, Headless Chromium Audit & Visual Fixes:**
   - Built UI shell, motion styles, `PipelineFlow`, `ProgressChecklist`, `DiffSuggestionsView`, `RulesRestorePanel`, and `tests/integration/app.test.tsx` (`166/166` tests across `29` files passing).
   - Ran Playwright Chromium audit (`1440x900` desktop and `390x844` mobile) against `vite preview`: verified `0` external network requests, `0` console/page errors, inert XSS rendering (`window.__xss === null`), all 5 redaction modes, Prompt Log modal, Rules, Restore, and Download.
   - Fixed audit findings: mobile drawer default/z-index blocking at `<=960px`, active-view `<h1>` heading hierarchy, inline `box-decoration-break: clone` pill tags (`white-space: nowrap`) preventing vertical tag wrapping, and vertical fit of `PipelineFlow` within `1440x900`.
5. **Phase 5 Final Verification & Docker Cloud Run Parity Smoke Test:**
   - Verified `npm test` (`29` test files / `166` tests passing), `npx tsc --noEmit` (`0` errors), `npm run lint` (`0` errors/warnings), and `npm run build` (`dist/` built cleanly).
   - Built `pii-sanitizer-local` multi-stage Docker image (`128MB`, running as non-root `uid=101(nginx)` on port `8080`) and verified `/healthz` (`200 ok`), strict CSP & hardening headers, and self-hosted `/ocr/worker.min.js`, `/ocr/lang/eng.traineddata.gz`, and `/fonts/NotoSansTC-Regular.ttf` (`200 OK`).
   - Note: `gcloud` CLI is not installed on this local host, so live Cloud Run deployment (`gcloud builds submit --config cloudbuild.yaml .` / `gcloud run deploy`) awaits execution from an authenticated Google Cloud SDK / Cloud Shell environment.
6. **UI Refinement — Minimal Landing Declutter & Tactile Hover Micro-Interactions:**
   - Decluttered the landing view (`App.tsx`, `LandingComposer.tsx`, `styles.css`): hid the empty right-side Audit Dashboard on the landing state, removed the `Local Engines` badge wall in favor of a single slim privacy pill, consolidated 7 wrapped sample buttons into 3 primary presets plus a `More formats` menu (`.md`, `.docx`, `.xlsx`, `.pdf`), and centered the hero composer.
   - Added pointer-fine (`@media (hover: hover) and (pointer: fine)`) tactile hover/focus/press states (`styles.css`, `motion.css`) across the composer hairline gradient rim, buttons, sample pills, sidebar items, mode pills, diff rows, pipeline nodes, and suggestion cards while respecting `prefers-reduced-motion: reduce`.
   - Re-verified with `npm test` (`29` files / `166` tests), `npx tsc --noEmit`, `npm run lint`, `npm run build`, Playwright desktop/mobile visual & zero-egress audit, and `docker build -t pii-sanitizer-local .`.
7. **Emil / `design-taste-frontend` / Mobile `390px` Polish & Real Per-Stage Timings:**
   - Unified motion tokens (`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `scale(0.97)` press, `@starting-style` menu/modal entrances, `[data-enter]` staggered landing reveal, `PipelineFlow` pulsing SVG signal dots) and fixed `390px` mobile `.topbar` / `.progress-item` wrapping (`index.html`, `styles.css`, `motion.css`, `LandingComposer.tsx`, `PipelineFlow.tsx`, `PromptLogModal.tsx`).
   - Replaced shared `scanMs / 4` and static `parseMs` with real `performance.now()` measurements per validator bucket (`scanMs`, `luhnMs`, `verhoeffMs`, `validatorsMs`) in `detector.ts`, `redactor.ts`, `pipeline.ts`, and `document-pipeline.ts`.
   - Re-verified `npm test` (`29` files / `166` tests), `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `docker build -t pii-sanitizer-local .`.
8. **Animated Light/Dark Theme Switcher & WCAG AA Light Mode:**
   - Added `ThemeToggle` in `.topbar-actions` (`App.tsx`, `styles.css`, `motion.css`) with `localStorage` persistence (`pii-sanitizer-theme`), `<meta name="theme-color">` sync, sliding thumb + Sun/Moon SVG transition, circular `clip-path` `document.startViewTransition` reveal (guarded by `prefers-reduced-motion: reduce`), and full `:root[data-theme='light']` WCAG AA palette overrides across landing, diff pills, pipeline dot-grid, and mobile views.
   - Added theme-toggle integration test in `tests/integration/app.test.tsx` (`29` files / `167` tests passing) and re-verified Playwright light/dark contrast, zero network egress, `tsc --noEmit`, `eslint`, `vite build`, and `docker build -t pii-sanitizer-local .`.
