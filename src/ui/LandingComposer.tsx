import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { MarkerStyle } from '../core/types';
import { ACCEPT_ATTR } from '../formats/index';
import { SAMPLE_PRESETS } from '../formats/samples';

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
  const [isDragging, setIsDragging] = useState(false);

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
      <div className="landing-header">
        <h1 id="landing-heading" className="landing-title">
          Client-Side PII Sanitizer
        </h1>
        <p className="landing-subtitle">
          Paste logs or drop .txt, .md, .csv, .docx, .xlsx, or .pdf files. Detection, OCR, and redaction execute locally in your browser.
        </p>
      </div>

      <form
        className={`composer-card${isDragging ? ' is-dragging' : ''}`}
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
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Paste raw logs, clinical notes, CSV rows, or drop up to 10 documents here..."
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
              <option value="pseudonym">Consistent Pseudonym (USER_01 / Reversible)</option>
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

      <div className="landing-meta-list">
        <div className="landing-meta-row">
          <span className="landing-meta-label">Quick Samples</span>
          <div className="sample-chips">
            {SAMPLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="sample-chip"
                onClick={() => onLoadSample(preset.id as SampleTriggerId)}
                disabled={isProcessing}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className="sample-chip"
              onClick={() => onLoadSample('markdown')}
              disabled={isProcessing}
            >
              Incident Brief (.md)
            </button>
            <button
              type="button"
              className="sample-chip"
              onClick={() => onLoadSample('docx')}
              disabled={isProcessing}
            >
              Sample Word (.docx)
            </button>
            <button
              type="button"
              className="sample-chip"
              onClick={() => onLoadSample('xlsx')}
              disabled={isProcessing}
            >
              Sample Excel (.xlsx)
            </button>
            <button
              type="button"
              className="sample-chip"
              onClick={() => onLoadSample('pdf')}
              disabled={isProcessing}
            >
              Sample PDF (.pdf)
            </button>
          </div>
        </div>

        <div className="landing-meta-row">
          <span className="landing-meta-label">Local Engines</span>
          <div className="capability-list">
            <span>PAN &amp; Verhoeff Aadhaar</span>
            <span>Luhn Credit Cards</span>
            <span>libphonenumber-js</span>
            <span>IBAN mod-97 &amp; SSN</span>
            <span>Self-Hosted English OCR</span>
            <span>Up to 10 files · 100 MB max</span>
          </div>
        </div>
      </div>
    </section>
  );
}
