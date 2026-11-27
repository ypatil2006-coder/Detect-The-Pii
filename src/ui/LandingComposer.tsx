/**
 * @module LandingComposer
 * @description Primary input area for the PII sanitizer workbench.
 *
 * Handles raw text paste, file drag-and-drop, file picker, 1-click sample loaders,
 * redaction mode/marker-style selection, and the Sanitize action.
 *
 * File validation (extension, size) is enforced before any parsing begins.
 * No file content is transmitted outside the browser.
 */
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { MarkerStyle } from '../core/types';
import { ACCEPT_ATTR } from '../formats/index';

export type SampleTriggerId =
  | 'support-log'
  | 'clinical-resume'
  | 'customers-csv'
  | 'markdown'
  | 'docx'
  | 'xlsx'
  | 'pdf';

export interface LandingComposerProps {
  draftText: string;
  onDraftChange: (text: string) => void;
  markerStyle: MarkerStyle;
  onMarkerStyleChange: (style: MarkerStyle) => void;
  onRunText: (text: string) => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onLoadSample: (sampleId: SampleTriggerId) => void;
  isProcessing: boolean;
}

const PRIMARY_SAMPLES: ReadonlyArray<{ id: SampleTriggerId; label: string; title: string }> = [
  {
    id: 'support-log',
    label: 'Support Log (.txt)',
    title: 'Multi-line support log with emails, +91/US phones, PAN, Aadhaar, Luhn & non-Luhn cards',
  },
  {
    id: 'customers-csv',
    label: 'Customer Audit (.csv)',
    title: 'RFC-4180 CSV with quoted commas, recurring entities, Aadhaar, PAN, and cards',
  },
  {
    id: 'clinical-resume',
    label: 'Clinical Note (.txt)',
    title: 'Onboarding & intake memo with synthetic Aadhaar, PAN, and billing card',
  },
];

const EXTRA_FORMAT_SAMPLES: ReadonlyArray<{ id: SampleTriggerId; label: string }> = [
  { id: 'markdown', label: 'Incident Brief (.md)' },
  { id: 'docx', label: 'Sample Word (.docx)' },
  { id: 'xlsx', label: 'Sample Excel (.xlsx)' },
  { id: 'pdf', label: 'Sample PDF (.pdf)' },
];

export function LandingComposer({
  draftText,
  onDraftChange,
  markerStyle,
  onMarkerStyleChange,
  onRunText,
  onUploadFiles,
  onLoadSample,
  isProcessing,
}: LandingComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreOpen]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!draftText.trim() || isProcessing) return;
    onRunText(draftText);
  };

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      onUploadFiles(event.dataTransfer.files);
    }
  };

  return (
    <section className="landing-stage" aria-labelledby="landing-heading">
      <div className="landing-header" data-enter="1">
        <h1 id="landing-heading" className="landing-title">
          Detect the PII
        </h1>
      </div>

      <form
        className={`composer-card${isDragging ? ' is-dragging' : ''}`}
        data-enter="2"
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <label htmlFor="landing-text-input" className="sr-only">
          Paste text to sanitize
        </label>
        <textarea
          id="landing-text-input"
          className="composer-textarea"
          rows={1}
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Paste logs, clinical notes, CSV rows, or drop up to 10 documents here..."
          disabled={isProcessing}
        />

        <div className="composer-toolbar">
          <div className="composer-left-controls">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="sr-only"
              aria-label="Upload documents for client-side sanitization"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onUploadFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Attach Files</span>
            </button>

            <label htmlFor="landing-mode-select" className="sr-only">
              Redaction mode
            </label>
            <select
              id="landing-mode-select"
              className="mode-select"
              value={markerStyle}
              onChange={(e) => onMarkerStyleChange(e.target.value as MarkerStyle)}
              disabled={isProcessing}
              aria-label="Redaction mode"
            >
              <option value="pseudonym">Consistent Pseudonym (USER_01)</option>
              <option value="partial">Partial Mask (Verify Last 4)</option>
              <option value="full">Full Mask ([REDACTED])</option>
              <option value="category">Category Tag ([EMAIL])</option>
              <option value="blank">Blank Placeholder (○○○)</option>
            </select>
          </div>

          <button
            type="submit"
            className="btn btn-contrast"
            disabled={isProcessing || !draftText.trim()}
          >
            {isProcessing ? 'Analyzing...' : 'Sanitize Text'}
          </button>
        </div>
      </form>

      <div className="landing-sample-bar" data-enter="3" aria-label="Quick sample datasets">
        <div className="landing-sample-row">
          {PRIMARY_SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              className="sample-chip"
              onClick={() => onLoadSample(sample.id)}
              disabled={isProcessing}
              title={sample.title}
            >
              {sample.label}
            </button>
          ))}

          <div className="more-formats-wrap" ref={moreMenuRef}>
            <button
              type="button"
              className={`sample-chip sample-chip--more${moreOpen ? ' is-open' : ''}`}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((prev) => !prev)}
              disabled={isProcessing}
            >
              <span>More formats</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {moreOpen && (
              <div className="more-formats-menu" role="menu" aria-label="Additional sample document formats">
                {EXTRA_FORMAT_SAMPLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="more-formats-item"
                    onClick={() => {
                      setMoreOpen(false);
                      onLoadSample(item.id);
                    }}
                    disabled={isProcessing}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
