# Client-Side PII Data Sanitizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 100% client-side browser PII sanitization web app (raw text + `.txt`/`.csv`, 6 PII types with Luhn/Verhoeff validation, 3 redaction modes, live side-by-side diff, entity counts, 1-click sample/download, prompt log) deployed on Google Cloud Run, using strict TDD and parallel-safe 2-agent ownership with UI built last.

**Architecture:** A pure TypeScript static Vite + React app where all parsing, validation, detection, redaction, and diff generation execute locally in the browser (plus a Web Worker for large files) with zero external API calls. After locking shared interfaces in `src/core/types.ts` (Task 1), **Agent A** builds and TDDs the core detection/redaction engine (`src/core/`) while **Agent B** independently builds and TDDs `.txt`/`.csv`/sample handlers (`src/formats/`) and Google Cloud Run containerization (`Dockerfile`, `nginx.conf`, `cloudbuild.yaml`). Both tracks merge into an end-to-end integration test gate (Task 5), followed by the accessible UI built last (Task 6) and Cloud Run deployment verification (Task 7).

**Tech Stack:** TypeScript 5 (strict), Vite 6, React 19 (or minimal DOM/React UI in Task 6), Vitest + `jsdom`, ESLint, Google Cloud Run (multi-stage non-root `nginx` on `$PORT=8080`).

**Spec:** [criteria.md](../../criteria.md)

---

## Global Constraints

- **100% Client-Side Processing:** Raw text, `.txt`/`.csv` files, and detected PII must never be sent to any external server/API; enforce `connect-src 'none'` in CSP.
- **Zero Unrequested Bloat (Karpathy Simplicity):** No PDF, DOCX, XLSX, ZIP, or OCR libraries (`tesseract.js`, `pdfjs-dist`, `pdf-lib`, `jszip` omitted); support raw text paste + `.txt`/`.csv` only.
- **Required PII Categories:** Email, Phone (`+91`/10-digit Indian & international), IPv4 (`0–255` octets) & IPv6, Indian PAN (`[A-Z]{5}[0-9]{4}[A-Z]` + 4th-char code), Indian Aadhaar (12-digit + Verhoeff checksum), Credit Card (13–19 digits + Luhn mod-10 validation).
- **Three Redaction Modes:** Full Mask (`[REDACTED]`), Partial Mask (`XXXX-XXXX-1234`, `j***@domain.com`, etc.), Consistent Pseudonymization (`USER_01`, `PHONE_01`, `IP_01`, `PAN_01`, `AADHAAR_01`, `CARD_01` consistent across the document).
- **Mandatory Deliverables:** Live side-by-side diff view with entity detection counts, 1-click sample noisy text loader, 1-click downloadable sanitized output, and `PROMPT_LOG.md`.
- **Hackathon DQ & Judging Gates:** Working live Google Cloud Run URL on `$PORT=8080` (`/healthz`), automated tests passing 100%, WCAG 2.1 AA accessibility, XSS-safe rendering (no `innerHTML`), and linear-time regexes (no ReDoS).

---

## Seams Under Test (Confirm Before Implementation)

Tests target public module boundaries rather than private helpers:
1. **`validators.ts` (`isValidLuhn`, `isValidVerhoeff`, `isValidPan`, `isValidIpv4`, `isValidIpv6`, `isValidEmail`, `isValidIndianOrIntlPhone`)** — *Catches:* false positives on random 16-digit/12-digit strings, bad IP octets, invalid PAN entity letters; *Misses:* multi-span context and overlap precedence.
2. **`detector.ts` (`detectPii(text)`)** — *Catches:* offset drift, overlap resolution bugs, Luhn-rejected count tracking, and ReDoS latency; *Misses:* mode-specific replacement text.
3. **`redactor.ts` + `diff.ts` (`sanitizeText(text, mode)`, `buildSideBySideDiff(text, detections, mode)`)** — *Catches:* Full/Partial/Pseudonymization output formatting, `USER_01` consistency across repeated entities, and aligned diff segment boundaries; *Misses:* CSV quoting/cell structure.
4. **`formats/csv.ts` + `formats/txt.ts` (`sanitizeCsv(csvText, sanitizeFn)`, `sanitizeTxt(text, sanitizeFn)`)** — *Catches:* RFC-4180 quoted commas/newlines, header preservation, and consistent pseudonym state shared across all rows; *Misses:* DOM file drag-drop events.
5. **`ui/` + `App` integration (`tests/integration/app.test.tsx`)** — *Catches:* XSS script-tag escaping, mode switching, 1-click sample load, live diff & ARIA count updates, and `Blob` download trigger; *Misses:* live Cloud Run container networking (covered in Task 7 smoke test).

---

## Review Focus

1. **Random 16-digit numeric strings (order IDs / tracking numbers failing Luhn):** Must NOT be flagged as credit cards and must increment `rejectedCandidates.creditCard` (pinned in Task 3A).
2. **Overlapping or adjacent patterns (`user9876543210@mail.com`, `999.168.1.1`, `v1.2.3.4`):** Longest/most specific valid match wins without breaking offsets, and invalid IPv4 octets/version tags are ignored (pinned in Task 3A).
3. **Quoted CSV cells with commas, escaped quotes, and newlines:** Sanitizing cells must preserve valid RFC-4180 CSV structure and maintain consistent `USER_01` mapping across rows (pinned in Task 2B).
4. **Format-variant consistency in Consistent Pseudonymization:** Identical entities with formatting variations (e.g. `4111-1111-1111-1111` and `4111 1111 1111 1111`, or repeated `rahul@acme.com`) map deterministically without colliding distinct values (pinned in Task 4A).
5. **XSS & ReDoS resilience:** `<script>alert(1)</script>` or `<img onerror=...>` next to PII renders strictly as inert text in the DOM, and 50KB of adversarial digit/space noise completes in `< 50ms` (pinned in Tasks 3A and 6).

---

## File Structure (Parallel-Safe Ownership)

| File | Owner | Responsibility |
|---|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js` | Shared Setup (Task 1) | Toolchain, strict TS, Vitest `jsdom`, ESLint config |
| `src/core/types.ts` | Shared Setup (Task 1) | Locked interfaces (`PiiType`, `RedactionMode`, `PiiMatch`, `SanitizeResult`, `DiffLine`, `SanitizeFn`) |
| `src/core/validators.ts` | **Agent A** (Task 2A) | Luhn, Aadhaar Verhoeff, PAN, IPv4/IPv6, Email, Phone validators |
| `src/core/detector.ts` | **Agent A** (Task 3A) | Linear-time regex scanning, validator filtering, longest-match overlap resolver |
| `src/core/redactor.ts` | **Agent A** (Task 4A) | Full Mask, Partial Mask, Consistent Pseudonymization (`USER_01`), entity counts |
| `src/core/diff.ts` | **Agent A** (Task 4A) | Line-aligned Original vs. Sanitized diff segments for UI rendering |
| `src/formats/txt.ts` | **Agent B** (Task 2B) | `.txt` validation, normalization, sanitization wrapper, download payload helper |
| `src/formats/csv.ts` | **Agent B** (Task 2B) | RFC-4180 CSV parser/serializer preserving quotes/delimiters & cross-row pseudonym consistency |
| `src/formats/samples.ts` | **Agent B** (Task 3B) | 1-click realistic noisy sample presets (Mixed Log, Support Ticket, Clinical Note, CSV) |
| `Dockerfile`, `nginx.conf`, `.dockerignore`, `cloudbuild.yaml`, `README.md`, `PROMPT_LOG.md` | **Agent B** (Task 4B) | Non-root Cloud Run container (`$PORT=8080`, `/healthz`, strict CSP) + prompt log |
| `src/core/worker.ts` + `src/core/pipeline.ts` | Merge (Task 5) | Browser Web Worker offloading + unified `runSanitizationPipeline` |
| `index.html`, `src/styles.css`, `src/main.tsx`, `src/ui/*.tsx` | UI Last (Task 6) | Accessible React UI (dropzone, 3-mode toggle, side-by-side diff, counts, download, prompt log modal) |
| `tests/unit/core/*.test.ts` | **Agent A** | TDD unit tests for validators, detector, redactor, diff |
| `tests/unit/formats/*.test.ts` | **Agent B** | TDD unit tests for CSV/TXT parsers & sample loader |
| `tests/integration/*.test.ts(x)` | Merge + UI (Tasks 5–6) | End-to-end pipeline, XSS safety, accessibility, download & diff integration tests |

---

## Phase 1: Foundation & Shared Contract (Single Agent First)

### Task 1: Initialize Project & Lock Shared Types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`
- Create: `src/core/types.ts`
- Test: `tests/unit/core/types.smoke.test.ts`

**Interfaces:**
- Produces in `src/core/types.ts`:
  - `export type PiiType = 'EMAIL' | 'PHONE' | 'IP' | 'PAN' | 'AADHAAR' | 'CREDIT_CARD';`
  - `export type RedactionMode = 'full' | 'partial' | 'pseudonym';`
  - `export interface PiiMatch { id: string; type: PiiType; value: string; normalized: string; start: number; end: number; }`
  - `export interface DetectionStats { total: number; byType: Record<PiiType, number>; rejectedCreditCards: number; rejectedAadhaar: number; }`
  - `export interface PseudonymMapEntry { placeholder: string; type: PiiType; maskedPreview: string; count: number; }`
  - `export interface SanitizeResult { original: string; sanitized: string; mode: RedactionMode; matches: PiiMatch[]; stats: DetectionStats; pseudonyms: PseudonymMapEntry[]; durationMs: number; }`
  - `export interface DiffSegment { text: string; kind: 'plain' | 'pii' | 'redacted'; type?: PiiType; placeholder?: string; }`
  - `export interface DiffRow { lineNumber: number; hasChanges: boolean; originalSegments: DiffSegment[]; sanitizedSegments: DiffSegment[]; }`
  - `export type SanitizeFn = (text: string, mode: RedactionMode, sharedState?: PseudonymState) => SanitizeResult;`
  - `export interface PseudonymState { map: Map<string, string>; counters: Record<PiiType, number>; }`

- [ ] **Step 1: Initialize git repo & create `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`**

Run in `/home/yash/Projects/Hackathons/PromptWars-NIAT-Pune`:
`git init && npm install` (after writing config files using React 19, TypeScript, Vite, Vitest, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, ESLint).

- [ ] **Step 2: Write failing smoke test for `src/core/types.ts`**

Create `tests/unit/core/types.smoke.test.ts` asserting `createEmptyStats()` returns zeroed counts for all 6 `PiiType` keys and `createPseudonymState()` initializes empty maps/counters.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/types.smoke.test.ts`
Expected: FAIL with module/export not found for `src/core/types`.

- [ ] **Step 4: Implement `src/core/types.ts` with locked types + `createEmptyStats()` and `createPseudonymState()`**

- [ ] **Step 5: Run test & typecheck to verify pass**

Run: `npx vitest run tests/unit/core/types.smoke.test.ts && npx tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts eslint.config.js .gitignore src/core/types.ts tests/unit/core/types.smoke.test.ts
git commit -m "chore: initialize project toolchain and lock shared PII core types"
```

---

## Phase 2: Parallel Work — Agent A (Core Engine) & Agent B (Formats + Cloud Run)

> **Concurrency Rule:** Agent A touches ONLY `src/core/` and `tests/unit/core/`. Agent B touches ONLY `src/formats/`, `tests/unit/formats/`, `Dockerfile`, `nginx.conf`, `.dockerignore`, `cloudbuild.yaml`, `README.md`, and `PROMPT_LOG.md`. Neither edits `src/core/types.ts` or each other's files.

### Agent A — Task 2A: Validators (`Luhn`, `Verhoeff`, `PAN`, `IP`, `Email`, `Phone`)

**Files:**
- Create: `src/core/validators.ts`
- Test: `tests/unit/core/validators.test.ts`

**Interfaces:**
- Consumes: `PiiType` from `./types`
- Produces in `src/core/validators.ts`:
  - `isValidLuhn(raw: string): boolean`
  - `isValidVerhoeff(raw: string): boolean`
  - `isValidPan(raw: string): boolean`
  - `isValidIpv4(raw: string): boolean`
  - `isValidIpv6(raw: string): boolean`
  - `isValidEmail(raw: string): boolean`
  - `isValidPhone(raw: string): boolean`
  - `normalizeEntityValue(type: PiiType, raw: string): string`

Work in strict **vertical TDD slices** (one validator test -> watch fail -> implement minimal validator -> watch pass -> next validator):

- [ ] **Step 1 (Slice 1 — Luhn): Write failing test for `isValidLuhn`**
  - Test valid Visa/Mastercard (`4111 1111 1111 1111`, `5500-0000-0000-0004`), reject non-Luhn 16-digit strings (`1234567890123456`, `4111111111111112`), reject `<13` or `>19` digits and all-zero strings.
- [ ] **Step 2: Run `npx vitest run tests/unit/core/validators.test.ts` → verify FAIL**
- [ ] **Step 3: Implement `isValidLuhn(raw: string): boolean` in `src/core/validators.ts`**
- [ ] **Step 4: Run test → verify PASS**

- [ ] **Step 5 (Slice 2 — Aadhaar Verhoeff): Write failing test for `isValidVerhoeff` + Indian PAN `isValidPan`**
  - Test valid Verhoeff 12-digit Aadhaar (starting `2–9`, rejecting `0`/`1` start, rejecting repeated identical digits `999999999999`, rejecting corrupted check digit).
  - Test valid PAN (`ABCDE1234F`, 4th char in `PCHABGJLFT`) vs invalid 4th char (`ABCDZ1234F`) or lowercase.
- [ ] **Step 6: Run test → verify FAIL**
- [ ] **Step 7: Implement `isValidVerhoeff` and `isValidPan` in `src/core/validators.ts`**
- [ ] **Step 8: Run test → verify PASS**

- [ ] **Step 9 (Slice 3 — IPv4/IPv6, Email, Phone, Normalization): Write failing tests**
  - `isValidIpv4`: accept `192.168.1.1`, `0.0.0.0`; reject `999.168.1.1`, `256.1.1.1`, `01.2.3.4` (or leading-dot version strings).
  - `isValidIpv6`: accept `2001:0db8:85a3:0000:0000:8a2e:0370:7334`, `fe80::1`, `::1`; reject times `12:34:56` and MAC `AA:BB:CC:DD:EE:FF`.
  - `isValidEmail` & `isValidPhone` (`+91 98765 43210`, `9876543210`, `+1 (415) 555-2671`; reject random 10-digit timestamps/years like `2026112701` when clearly non-phone or <10 digits).
  - `normalizeEntityValue`: strips spaces/hyphens for cards/Aadhaar/phones and lowercases emails so consistent pseudonymization matches variants.
- [ ] **Step 10: Run test → verify FAIL**
- [ ] **Step 11: Implement remaining functions in `src/core/validators.ts`**
- [ ] **Step 12: Run full Agent A test file & `tsc --noEmit` → verify PASS**
- [ ] **Step 13: Commit**

```bash
git add src/core/validators.ts tests/unit/core/validators.test.ts
git commit -m "feat(core): add TDD-verified Luhn, Verhoeff, PAN, IP, email, and phone validators"
```

---

### Agent A — Task 3A: Detector, Overlap Resolver & False-Positive Stats

**Files:**
- Create: `src/core/detector.ts`
- Test: `tests/unit/core/detector.test.ts`

**Interfaces:**
- Consumes: `PiiMatch`, `PiiType`, `DetectionStats`, `createEmptyStats` from `./types`; validators + `normalizeEntityValue` from `./validators`
- Produces in `src/core/detector.ts`:
  - `detectPii(text: string): { matches: PiiMatch[]; stats: DetectionStats }`

- [ ] **Step 1 (Slice 1 — Multi-entity detection & Luhn/Verhoeff rejection counting): Write failing test**
  - Given text with an email, `+91` phone, IPv4, PAN, Verhoeff-valid Aadhaar, Luhn-valid Visa card, AND a random 16-digit number `1234-5678-9012-3456` (fails Luhn) + invalid 12-digit `1234 5678 9012`: asserts exact 6 valid matches, `stats.rejectedCreditCards === 1`, `stats.rejectedAadhaar >= 1`.
- [ ] **Step 2: Run `npx vitest run tests/unit/core/detector.test.ts` → verify FAIL**
- [ ] **Step 3: Implement linear-time scanning + validator filtering in `src/core/detector.ts`**
- [ ] **Step 4: Run test → verify PASS**

- [ ] **Step 5 (Slice 2 — Review Focus: Overlaps, invalid IPv4/version strings, and ReDoS latency): Write failing tests**
  - `user9876543210@mail.com` detects only `EMAIL` (not an overlapping `PHONE` inside the email local-part).
  - `Release v1.2.3.4 and invalid 999.168.1.1` yields 0 `IP` detections (version prefix `v1.2.3.4` and out-of-range octet `999` ignored).
  - 50,000-char string of digits/spaces/punctuation runs `detectPii()` in `< 50ms`.
- [ ] **Step 6: Run test → verify FAIL**
- [ ] **Step 7: Implement longest/highest-priority non-overlapping span resolver & boundary checks in `src/core/detector.ts`**
- [ ] **Step 8: Run `npx vitest run tests/unit/core/` → verify all Agent A tests PASS**
- [ ] **Step 9: Commit**

```bash
git add src/core/detector.ts tests/unit/core/detector.test.ts
git commit -m "feat(core): add linear-time PII detector, overlap resolver, and rejection stats"
```

---

### Agent A — Task 4A: Redaction Modes, Consistent Pseudonymization & Side-by-Side Diff

**Files:**
- Create: `src/core/redactor.ts`, `src/core/diff.ts`
- Test: `tests/unit/core/redactor.test.ts`, `tests/unit/core/diff.test.ts`

**Interfaces:**
- Consumes: `PiiMatch`, `PiiType`, `RedactionMode`, `SanitizeResult`, `PseudonymState`, `PseudonymMapEntry`, `DiffRow`, `DiffSegment`, `createPseudonymState` from `./types`; `detectPii` from `./detector`
- Produces:
  - In `src/core/redactor.ts`:
    - `formatPartialMask(type: PiiType, raw: string): string`
    - `sanitizeText(text: string, mode: RedactionMode, sharedState?: PseudonymState): SanitizeResult`
  - In `src/core/diff.ts`:
    - `buildSideBySideDiff(original: string, matches: PiiMatch[], mode: RedactionMode, replacements: string[]): DiffRow[]`

- [ ] **Step 1 (Slice 1 — Full & Partial Mask): Write failing test**
  - `full`: replaces every detected match with `[REDACTED]`.
  - `partial`: `4111-1111-1111-1111` → `XXXX-XXXX-XXXX-1111` (preserves last 4), Aadhaar `XXXX-XXXX-1234`, Email `r***@acme.com`, PAN `AB***1234F` (or `ABCDE****F`), IP `192.168.***.***`, Phone `+91-XXXXXX3210`.
- [ ] **Step 2: Run `npx vitest run tests/unit/core/redactor.test.ts` → verify FAIL**
- [ ] **Step 3: Implement `formatPartialMask` and `sanitizeText` (`full`/`partial`) in `src/core/redactor.ts`**
- [ ] **Step 4: Run test → verify PASS**

- [ ] **Step 5 (Slice 2 — Consistent Pseudonymization + Review Focus Format Variants): Write failing test**
  - Repeated `rahul@acme.com` on lines 1 and 3 maps to `USER_01` both times; `priya@acme.com` maps to `USER_02`.
  - Card `4111-1111-1111-1111` and `4111 1111 1111 1111` normalize to the same `CARD_01` token.
  - Passing `sharedState` across two calls (`sanitizeText(row1, 'pseudonym', state)` then `sanitizeText(row2, 'pseudonym', state)`) preserves `USER_01` across calls.
  - `pseudonyms` array includes `placeholder`, `type`, `maskedPreview` (never raw unmasked PII in preview summary if not needed, or clean count), and `count`.
- [ ] **Step 6: Run test → verify FAIL**
- [ ] **Step 7: Implement `pseudonym` mode with deterministic `USER_XX` / `PHONE_XX` / `IP_XX` / `PAN_XX` / `AADHAAR_XX` / `CARD_XX` prefixes in `src/core/redactor.ts`**
- [ ] **Step 8: Run test → verify PASS**

- [ ] **Step 9 (Slice 3 — Side-by-Side Diff Builder): Write failing test in `tests/unit/core/diff.test.ts`**
  - Multi-line text with PII on line 1 and line 3, plain text on line 2: asserts `DiffRow[]` has 3 rows, `hasChanges` is `true` for lines 1 & 3 and `false` for line 2, `originalSegments` reconstructs original lines verbatim, and `sanitizedSegments` reconstructs sanitized lines verbatim with `kind: 'pii'` / `'redacted'` metadata.
- [ ] **Step 10: Run test → verify FAIL**
- [ ] **Step 11: Implement `buildSideBySideDiff` in `src/core/diff.ts`**
- [ ] **Step 12: Run full Agent A test suite `npx vitest run tests/unit/core/` && `npx tsc --noEmit` → verify PASS**
- [ ] **Step 13: Commit**

```bash
git add src/core/redactor.ts src/core/diff.ts tests/unit/core/redactor.test.ts tests/unit/core/diff.test.ts
git commit -m "feat(core): add full/partial/pseudonym redaction modes and line-aligned diff builder"
```

---

### Agent B — Task 2B: Client-Side `.txt` & `.csv` Parsers & Exporters

**Files:**
- Create: `src/formats/txt.ts`, `src/formats/csv.ts`
- Test: `tests/unit/formats/formats.test.ts`

**Interfaces:**
- Consumes: `RedactionMode`, `SanitizeFn`, `SanitizeResult`, `DetectionStats`, `PseudonymMapEntry`, `createEmptyStats`, `createPseudonymState` from `../core/types`
- Produces:
  - In `src/formats/txt.ts`:
    - `validateUploadFile(file: { name: string; size: number }, maxBytes?: number): { ok: true; kind: 'txt' | 'csv' } | { ok: false; error: string }`
    - `buildDownloadFilename(originalName: string | null, kind: 'txt' | 'csv', mode: RedactionMode): string`
  - In `src/formats/csv.ts`:
    - `parseCsv(text: string): string[][]`
    - `serializeCsv(rows: string[][]): string`
    - `sanitizeCsv(csvText: string, mode: RedactionMode, sanitizeFn: SanitizeFn): { sanitizedCsv: string; stats: DetectionStats; pseudonyms: PseudonymMapEntry[]; rowCount: number; columnCount: number }`

*Note:* Notice `sanitizeCsv` uses dependency injection (`sanitizeFn: SanitizeFn`), so Agent B can write and run ALL CSV unit tests completely independently of Agent A using a simple stub `SanitizeFn` in unit tests!

- [ ] **Step 1 (Slice 1 — File validation & filename builder): Write failing test in `tests/unit/formats/formats.test.ts`**
  - Accept `.txt` and `.csv` (`text.txt`, `DATA.CSV`), reject `.exe`, `.pdf`, or `> 10MB` files with descriptive error; verify `buildDownloadFilename('tickets.csv', 'csv', 'pseudonym') === 'tickets.sanitized-pseudonym.csv'`.
- [ ] **Step 2: Run `npx vitest run tests/unit/formats/formats.test.ts` → verify FAIL**
- [ ] **Step 3: Implement `src/formats/txt.ts`**
- [ ] **Step 4: Run test → verify PASS**

- [ ] **Step 5 (Slice 2 — Review Focus: RFC-4180 CSV parser, serializer & cross-row `sanitizeCsv`): Write failing tests**
  - `parseCsv` + `serializeCsv` round-trip quoted commas (`"Sharma, Rahul"`), escaped double quotes (`"He said ""hi"""`), and embedded newlines inside quotes.
  - `sanitizeCsv` passes one shared `PseudonymState` across every cell, aggregates `stats`, preserves header/column alignment, and keeps valid CSV quoting when sanitized output contains commas or spaces.
- [ ] **Step 6: Run test → verify FAIL**
- [ ] **Step 7: Implement `src/formats/csv.ts`**
- [ ] **Step 8: Run `npx vitest run tests/unit/formats/formats.test.ts` → verify PASS**
- [ ] **Step 9: Commit**

```bash
git add src/formats/txt.ts src/formats/csv.ts tests/unit/formats/formats.test.ts
git commit -m "feat(formats): add client-side TXT/CSV validation, RFC-4180 parser, and sanitization wrapper"
```

---

### Agent B — Task 3B: 1-Click Sample Noisy Text Loader

**Files:**
- Create: `src/formats/samples.ts`
- Test: `tests/unit/formats/samples.test.ts`

**Interfaces:**
- Produces in `src/formats/samples.ts`:
  - `export interface SamplePreset { id: string; label: string; kind: 'txt' | 'csv'; description: string; content: string; }`
  - `export const SAMPLE_PRESETS: SamplePreset[];`
  - `export function getSampleById(id: string): SamplePreset;`

- [ ] **Step 1: Write failing test in `tests/unit/formats/samples.test.ts`**
  - Assert `SAMPLE_PRESETS` contains at least 3 realistic presets (`support-log`, `clinical-resume`, `customers-csv`), uses strictly synthetic/fictional PII (standard test Visa `4111...`, valid Verhoeff synthetic Aadhaar, valid synthetic PAN, recurring email to showcase `USER_01` consistency, plus a deliberate 16-digit non-Luhn order ID to demonstrate Luhn filtering).
- [ ] **Step 2: Run `npx vitest run tests/unit/formats/samples.test.ts` → verify FAIL**
- [ ] **Step 3: Implement `src/formats/samples.ts`**
- [ ] **Step 4: Run test → verify PASS**
- [ ] **Step 5: Commit**

```bash
git add src/formats/samples.ts tests/unit/formats/samples.test.ts
git commit -m "feat(formats): add 1-click synthetic noisy sample datasets (logs, clinical, CSV)"
```

---

### Agent B — Task 4B: Google Cloud Run Packaging, Security Headers & Prompt Log

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `nginx.conf`, `cloudbuild.yaml`, `README.md`, `PROMPT_LOG.md`
- Test: `tests/unit/formats/deploy-config.test.ts`

**Interfaces:**
- Produces deployment & deliverable artifacts:
  - `Dockerfile`: multi-stage (`node:22-alpine` build → unprivileged `nginxinc/nginx-unprivileged:alpine` serving `/usr/share/nginx/html` on port `8080`, `PORT=8080`).
  - `nginx.conf`: listens on `8080`, serves `/healthz` returning `200 ok`, sets `Content-Security-Policy: default-src 'self'; connect-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
  - `cloudbuild.yaml`: Google Cloud Build pipeline building image → Artifact Registry → `gcloud run deploy`.
  - `PROMPT_LOG.md`: Structured prompt log deliverable ready to update through final build & deploy.

- [ ] **Step 1: Write failing config-verification test in `tests/unit/formats/deploy-config.test.ts`**
  - Asserts `Dockerfile` exposes/uses `8080` and non-root user, `nginx.conf` contains `/healthz` and `connect-src 'none'` and `X-Content-Type-Options`, and `PROMPT_LOG.md` + `cloudbuild.yaml` exist and are non-empty.
- [ ] **Step 2: Run `npx vitest run tests/unit/formats/deploy-config.test.ts` → verify FAIL**
- [ ] **Step 3: Create `Dockerfile`, `.dockerignore`, `nginx.conf`, `cloudbuild.yaml`, `README.md`, and `PROMPT_LOG.md`**
- [ ] **Step 4: Run test → verify PASS**
- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore nginx.conf cloudbuild.yaml README.md PROMPT_LOG.md tests/unit/formats/deploy-config.test.ts
git commit -m "build(deploy): add Cloud Run non-root container, strict CSP nginx config, and prompt log"
```

---

## Phase 3: Integration Gate (After Agent A + Agent B Complete)

### Task 5: Unified Pipeline, Web Worker Offloading & End-to-End Integration Tests

**Files:**
- Create: `src/core/pipeline.ts`, `src/core/worker.ts`
- Test: `tests/integration/pipeline.test.ts`

**Interfaces:**
- Consumes: `sanitizeText` (`src/core/redactor`), `buildSideBySideDiff` (`src/core/diff`), `sanitizeCsv` (`src/formats/csv`), `SAMPLE_PRESETS` (`src/formats/samples`)
- Produces:
  - `runPipeline(input: string, kind: 'txt' | 'csv', mode: RedactionMode): PipelineOutput` (returns `sanitized`, `stats`, `pseudonyms`, `diffRows`, `durationMs`)
  - Web Worker message wrapper (`WorkerRequest` / `WorkerResponse`) falling back gracefully to synchronous `runPipeline` when `Worker` is unavailable (e.g. `jsdom`).

- [ ] **Step 1: Write failing integration tests in `tests/integration/pipeline.test.ts`**
  - Run `runPipeline` on every preset in `SAMPLE_PRESETS` across `'full'`, `'partial'`, and `'pseudonym'` modes:
    - Assert zero raw emails/PAN/Aadhaar/Luhn-cards remain in `sanitized`.
    - Assert the deliberate non-Luhn 16-digit order ID in the sample *remains intact* and `stats.rejectedCreditCards >= 1`.
    - Assert `'pseudonym'` maps recurring email to `USER_01` across both `.txt` lines and `.csv` rows.
    - Assert `diffRows` aligns line-for-line with `input` and `sanitized`.
- [ ] **Step 2: Run `npx vitest run tests/integration/pipeline.test.ts` → verify FAIL**
- [ ] **Step 3: Implement `src/core/pipeline.ts` and `src/core/worker.ts`**
- [ ] **Step 4: Run entire suite `npx vitest run && npx tsc --noEmit` → verify ALL unit + integration tests PASS**
- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline.ts src/core/worker.ts tests/integration/pipeline.test.ts
git commit -m "feat(pipeline): wire core detector, CSV/TXT handlers, and Web Worker pipeline"
```

---

## Phase 4: UI Last (After Core + Formats + Integration Tests Pass 100%)

### Task 6: Accessible, XSS-Safe Client-Side UI & Integration Tests

**Files:**
- Create: `index.html`, `src/styles.css`, `src/main.tsx`, `src/ui/App.tsx`, `src/ui/DropzoneInput.tsx`, `src/ui/ModeToolbar.tsx`, `src/ui/AuditSummary.tsx`, `src/ui/DiffViewer.tsx`, `src/ui/PromptLogModal.tsx`
- Test: `tests/integration/app.test.tsx`

*Note:* If the user supplies UI visual references before Task 6 starts, match their layout/palette/typography tokens in `src/styles.css` and `src/ui/*`; otherwise use a high-contrast Swiss-grid devtool UI with WCAG 2.1 AA contrast (`>= 4.5:1`), semantic landmarks, keyboard navigation, and `prefers-reduced-motion`.

**Interfaces:**
- Consumes: `runPipeline` (`src/core/pipeline`), `validateUploadFile`, `buildDownloadFilename` (`src/formats/txt`), `SAMPLE_PRESETS` (`src/formats/samples`)
- Produces: Complete browser UI mountable in `index.html` with strict CSP `<meta>` fallback (`connect-src 'none'`).

- [ ] **Step 1: Write failing UI + a11y + XSS integration tests in `tests/integration/app.test.tsx`**
  - Renders `<App />`, clicks **"Load Sample"**, verifies `aria-live="polite"` entity count summary updates with non-zero counts for Emails, Phones, IPs, PAN, Aadhaar, Credit Cards, and Luhn-rejected count.
  - Switches mode radio/tabs (`Full Mask` → `Partial Mask` → `Consistent Pseudonym`) and asserts side-by-side diff updates (`[REDACTED]` vs `XXXX-` vs `USER_01`).
  - **Review Focus XSS test:** Types `<script>window.__xss=1</script> rahul@acme.com` into input; verifies `<script>` does not execute, renders as literal text, and `rahul@acme.com` is redacted.
  - Triggers `.csv` file upload and 1-click download button; asserts `URL.createObjectURL` is called with sanitized `Blob` and zero `fetch` calls occur.
  - Verifies semantic landmarks (`main`, `header`), accessible button/input names, and keyboard focusability.
- [ ] **Step 2: Run `npx vitest run tests/integration/app.test.tsx` → verify FAIL**
- [ ] **Step 3: Implement `index.html`, `src/styles.css`, `src/main.tsx`, and `src/ui/*.tsx` (strict JSX text rendering only — zero `dangerouslySetInnerHTML`)**
- [ ] **Step 4: Run `npx vitest run && npm run lint && npm run build` → verify PASS with zero warnings/errors**
- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/main.tsx src/ui tests/integration/app.test.tsx
git commit -m "feat(ui): build accessible client-side diff UI, sample loader, download, and prompt log viewer"
```

---

## Phase 5: Final Verification & Cloud Run Deployment

### Task 7: Final Verification Gate, Container Smoke Test & Cloud Run Deploy

**Files:**
- Modify: `PROMPT_LOG.md` (append final implementation/test/deploy entries), `criteria.md` (check off completed items)

- [ ] **Step 1: Run full verification suite**
  - Run: `npm test && npm run lint && npm run build`
  - Expected: 100% tests pass, 0 lint errors, clean `dist/` bundle.
- [ ] **Step 2: Local Docker + Cloud Run parity smoke test**
  - Run: `docker build -t pii-sanitizer . && docker run -d --rm -p 8080:8080 --name pii-check pii-sanitizer`
  - Verify `curl -i http://localhost:8080/healthz` returns `200` and `curl -I http://localhost:8080/` includes `Content-Security-Policy` with `connect-src 'none'`.
  - Stop container: `docker stop pii-check`.
- [ ] **Step 3: Deploy to Google Cloud Run & verify live `https://...run.app` link**
  - Run `gcloud run deploy pii-sanitizer --source . --port 8080 --allow-unauthenticated ...` (or via `cloudbuild.yaml`).
  - Open live URL, run sample loader + file upload + download with DevTools Network tab open (confirming zero outbound PII requests).
- [ ] **Step 4: Finalize `PROMPT_LOG.md` & `criteria.md` and push final commit**
  - Remember: **only the final submission score counts**—verify clean git state and passing checks on the exact final commit.

---

## Self-Review Checklist (Verified Against `criteria.md`)
- **Spec Coverage:** Every mandatory requirement in `criteria.md` (paste + `.txt`/`.csv`, 6 PII types, Luhn + Verhoeff, 3 modes, side-by-side diff + entity counts, 1-click sample + download, `PROMPT_LOG.md`, 7 AI Judge signals, Cloud Run port `8080`) maps 1:1 to Tasks 1–7.
- **Parallel Safety:** Agent A (`src/core/` + `tests/unit/core/`) and Agent B (`src/formats/` + `tests/unit/formats/` + deploy files) have zero overlapping files after Task 1 locks `src/core/types.ts`.
- **UI Last:** Task 6 executes only after Task 5's end-to-end pipeline integration tests are green.
- **TDD & Simplicity:** Every task starts with failing tests, keeps dependencies minimal (no OCR/PDF bloat), and keeps steps unambiguous.
