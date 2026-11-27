import { useEffect } from 'react';

export interface PromptLogModalProps {
  open: boolean;
  onClose: () => void;
}

export function PromptLogModal({ open, onClose }: PromptLogModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-log-title"
      >
        <div className="modal-header">
          <h2 id="prompt-log-title" className="modal-title">
            Prompt Log &amp; Verification Record
          </h2>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="Close prompt log"
          >
            Close
          </button>
        </div>

        <div className="modal-body">
          <section className="log-step">
            <h3>1. Problem &amp; Zero-Egress Constraints</h3>
            <p>
              Built as a 100% client-side browser PII sanitizer deployable on Google Cloud Run (port 8080) with strict Content Security Policy (connect-src &apos;self&apos;, worker-src &apos;self&apos; blob:, &apos;wasm-unsafe-eval&apos;) and self-hosted OCR assets so raw documents never leave the user&apos;s device.
            </p>
          </section>

          <section className="log-step">
            <h3>2. Core Detection &amp; Checksum Validation</h3>
            <ul>
              <li>Indian PAN ([A-Z]&#123;5&#125;[0-9]&#123;4&#125;[A-Z] + 4th-char entity code) and Indian Aadhaar (12-digit + Verhoeff checksum).</li>
              <li>Credit/Debit Cards (13–19 digits + Luhn mod-10 + issuer prefix) tracking false-positive rejections.</li>
              <li>libphonenumber-js + Indian +91 / 0-prefixed mobile phones, RFC-practical Email, IPv4 (0–255) &amp; IPv6, US SSN, ISO 7064 mod-97 IBAN, labelled DOB, and custom user RegExp rules.</li>
            </ul>
          </section>

          <section className="log-step">
            <h3>3. Multi-Format Parsers, OCR &amp; Reversible Mapping</h3>
            <ul>
              <li>Supports .txt, .md, RFC-4180 .csv, .docx (run-aware XML), .xlsx (sharedStrings scrub), and .pdf (coordinate text rebuild + self-hosted English Tesseract OCR).</li>
              <li>5 redaction modes (Full Mask, Partial Mask, Consistent Pseudonym USER_01 / [CATEGORY:hex6], Category Tag, Blank Placeholder) plus batch ZIP export and offline .mapping.csv Restore.</li>
            </ul>
          </section>

          <section className="log-step">
            <h3>4. Security, Accessibility &amp; Deployment Gates</h3>
            <ul>
              <li>Zero innerHTML / dangerouslySetInnerHTML; React JSX text nodes prevent XSS payloads.</li>
              <li>Semantic landmarks, visible :focus-visible rings, aria-live status announcements, and non-color badges.</li>
              <li>Multi-stage Node 22 build served via unprivileged nginx on port 8080 with /healthz.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
