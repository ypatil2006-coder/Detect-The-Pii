# Architecture — Detect the PII

## Overview

A single-page application with zero backend. Every operation (parsing, detection, validation, redaction, export) runs inside the user's browser.

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Sandbox                          │
│                                                              │
│  ┌──────────┐    ┌─────────────────────────────────────┐    │
│  │   React  │    │          Core Pipeline               │    │
│  │   19 UI  │───▶│                                     │    │
│  │          │    │  File Router → Parser → Detector    │    │
│  │ App.tsx  │    │      → Validator → Redactor         │    │
│  │ Sidebar  │    │      → Diff Builder → Exporter      │    │
│  │ Diff     │◀───│                                     │    │
│  │ Audit    │    └───────────────┬─────────────────────┘    │
│  └──────────┘                   │                           │
│                    ┌────────────▼──────────────┐            │
│                    │       Web Workers          │            │
│                    │  - Tesseract.js (OCR)      │            │
│                    │  - PDF.js (PDF parse)      │            │
│                    └───────────────────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 public/ (self-hosted)                 │   │
│  │  /ocr/worker.min.js  /ocr/lang/eng.traineddata.gz    │   │
│  │  /fonts/NotoSansTC-Regular.ttf  (PDF subsetting)     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ⛔ Zero external network calls (CSP: connect-src 'self')   │
└─────────────────────────────────────────────────────────────┘
```

## Module Structure

```
src/
├── core/                     # Pure business logic (no React)
│   ├── types.ts              # All shared TypeScript interfaces & types
│   ├── patterns.ts           # Built-in PII detection rule definitions
│   ├── pattern-store.ts      # Rule manager (built-in + custom, localStorage)
│   ├── validators.ts         # Luhn, Verhoeff, PAN, IPv4/6, email, phone, IBAN, SSN, DOB
│   ├── detector.ts           # Multi-pass regex scan + validation + overlap resolver
│   ├── redactor.ts           # Mode operator (full/partial/pseudonym/category/blank)
│   ├── mask.ts               # Partial-mask formatters per entity type
│   ├── codes.ts              # Deterministic pseudonym code generator (USER_01 etc.)
│   ├── retention.ts          # Head/tail/delimiter retention split helpers
│   ├── diff.ts               # Character-level diff for side-by-side viewer
│   ├── pipeline.ts           # Orchestrates detect → redact → diff for text
│   ├── document-pipeline.ts  # Orchestrates multi-format document processing
│   └── worker.ts             # Web Worker message handler
│
├── formats/                  # Format-specific parsers & exporters
│   (docx, xlsx, pdf, csv, ocr — loaded lazily via dynamic import)
│
├── ui/                       # React components
│   ├── App.tsx               # Root state, theme, routing between views
│   ├── LandingComposer.tsx   # Input area, file drop, sample loader, action bar
│   ├── DiffSuggestionsView.tsx  # Side-by-side diff + suggestion toggles
│   ├── AuditPanel.tsx        # Entity counts, pseudonym map, manual redaction
│   ├── ProgressChecklist.tsx # Pipeline step progress animation
│   ├── Sidebar.tsx           # Nav, session files, privacy status
│   ├── RulesRestorePanel.tsx # Custom rules editor, batch restore
│   ├── PipelineFlow.tsx      # Visual pipeline replay/scrubber
│   └── PromptLogModal.tsx    # Prompt log viewer
│
├── styles.css                # Design tokens, layout, dark/light theme
└── main.tsx                  # Vite entry point
```

## Data Flow

```
User Input (paste / file drop)
    │
    ▼
LandingComposer
    │  File.text() / File.arrayBuffer()
    ▼
document-pipeline.ts
    │  format detection → parser (txt/csv/docx/xlsx/pdf+ocr)
    ▼
detector.ts
    │  regex scan → validation (Luhn/Verhoeff/PAN/phone/IBAN)
    │  → overlap resolution (longest-span-wins)
    ▼
redactor.ts
    │  mode operator → pseudonym state (cross-file consistent)
    ▼
diff.ts
    │  character-level diff → DiffRow[]
    ▼
UI (DiffSuggestionsView, AuditPanel)
    │
    ▼
Export (download sanitized file / ZIP / mapping.csv)
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Browser-only** | Eliminates all server-side attack surface; user data never transmits |
| **Web Workers for OCR/PDF** | Keeps main thread responsive; heavy WASM runs off-thread |
| **Self-hosted all assets** | Satisfies strict CSP `connect-src 'self'`; works offline |
| **Verhoeff over regex-only for Aadhaar** | Reduces false positives from random 12-digit numbers by ~99.9% |
| **Luhn + issuer prefix for cards** | Eliminates order/tracking IDs from redaction |
| **Deterministic pseudonyms** | Consistent `USER_01` across all lines/files enables document restoration |
| **Reversible `.mapping.csv`** | Authorized users can restore originals client-side; no server round-trip needed |

## Testing Strategy

| Layer | Coverage |
|---|---|
| Unit — validators | Luhn, Verhoeff, PAN, IPv4/6, email, phone (libphonenumber), IBAN mod-97, SSN, DOB |
| Unit — redaction | All 5 modes, pseudonym consistency, overlap resolver, restore round-trip |
| Unit — formats | txt, csv (RFC-4180), docx, xlsx, pdf (text + OCR layout), batch ZIP |
| Integration — pipeline | Multi-format end-to-end, timing, error propagation |
| Integration — UI | React Testing Library: landmarks, keyboard nav, XSS safety, theme persistence, aria-live |
| Security | XSS payload render-safety, ReDoS guard on custom regex patterns |

**Total: 167 tests / 29 files — 100% passing (`npm test`)**
