import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import type { DocumentSessionResult } from '../core/document-pipeline';
import { previewLabel } from '../core/redactor';
import {
  EXTENDED_CATEGORIES,
  type DiffSegment,
  type ExtendedCategory,
  type MarkerStyle,
  type RedactionItem,
} from '../core/types';

export interface DiffSuggestionsViewProps {
  session: DocumentSessionResult;
  markerStyle: MarkerStyle;
  onMarkerStyleChange: (style: MarkerStyle) => void;
  onToggleItem: (id: string) => void;
  onToggleCategory: (category: ExtendedCategory, active: boolean) => void;
  onAddManual: (start: number, end: number, category: ExtendedCategory) => void;
  onResetManual?: () => void;
}

const MODE_OPTIONS: ReadonlyArray<{
  id: MarkerStyle;
  label: string;
  example: string;
}> = [
  { id: 'full', label: 'Full Mask', example: '[REDACTED]' },
  { id: 'partial', label: 'Partial Mask', example: 'XXXX-1111' },
  { id: 'pseudonym', label: 'Consistent Pseudonym (USER_01)', example: 'USER_01' },
  { id: 'category', label: 'Category Tag', example: '[EMAIL]' },
  { id: 'blank', label: 'Blank Placeholder', example: '○○○' },
];

function computeLineOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineNumberAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(1, hi + 1);
}

function renderSegment(seg: DiffSegment, index: number) {
  if (seg.kind === 'plain') {
    return <span key={index}>{seg.text}</span>;
  }
  const derivedTag =
    seg.type ??
    (seg.placeholder?.startsWith('[') && seg.placeholder.endsWith(']')
      ? seg.placeholder.slice(1, -1)
      : 'PII');
  const pillClass = seg.type ? `pii-pill--${seg.type}` : 'pii-pill--CUSTOM';
  if (seg.kind === 'pii') {
    return (
      <span key={index} className={`pii-pill ${pillClass}`}>
        <span className="pii-pill__tag">{derivedTag}</span>
        <span>{seg.text}</span>
      </span>
    );
  }
  return (
    <span key={index} className="pii-pill pii-pill--redacted">
      <span className="pii-pill__tag">{derivedTag}</span>
      <span>{seg.text}</span>
    </span>
  );
}

/**
 * 5-mode redaction switcher, synchronized side-by-side Original vs. Sanitized diff view,
 * and interactive Suggestions & Review sidebar with manual span support.
 * Renders exclusively via React JSX text nodes (zero dangerouslySetInnerHTML).
 */
export function DiffSuggestionsView({
  session,
  markerStyle,
  onMarkerStyleChange,
  onToggleItem,
  onToggleCategory,
  onAddManual,
  onResetManual,
}: DiffSuggestionsViewProps) {
  const [changedOnly, setChangedOnly] = useState(false);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');
  const [manualCategory, setManualCategory] = useState<ExtendedCategory>('CUSTOM');
  const [manualError, setManualError] = useState<string | null>(null);

  const lineStarts = useMemo(() => computeLineOffsets(session.doc.text), [session.doc.text]);

  const visibleRows = useMemo(
    () => (changedOnly ? session.diffRows.filter((r) => r.hasChanges) : session.diffRows),
    [changedOnly, session.diffRows],
  );

  const categorySummary = useMemo(() => {
    const map = new Map<ExtendedCategory, { total: number; active: number }>();
    for (const item of session.items) {
      const curr = map.get(item.category) ?? { total: 0, active: 0 };
      curr.total += 1;
      if (item.active) curr.active += 1;
      map.set(item.category, curr);
    }
    return Array.from(map.entries());
  }, [session.items]);

  const hasOverrides = useMemo(
    () => session.items.some((it) => it.origin === 'manual' || !it.active),
    [session.items],
  );

  const handleJumpToItem = (item: RedactionItem) => {
    setSelectedItemId(item.id);
    setHighlightedLine(lineNumberAt(lineStarts, item.start));
  };

  const handleToggleItemSafe = (id: string) => {
    setManualError(null);
    try {
      onToggleItem(id);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Unable to toggle redaction item.');
    }
  };

  const handleCaptureSelection = () => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const text = sel ? sel.toString().trim() : '';
    if (text) {
      setManualText(text);
      setManualError(null);
    }
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    setManualError(null);
    const needle = manualText.trim();
    if (!needle) {
      setManualError('Enter or select text from the document to redact.');
      return;
    }
    const start = session.doc.text.indexOf(needle);
    if (start < 0) {
      setManualError(`Text "${needle.slice(0, 32)}" was not found in the document.`);
      return;
    }
    const end = start + needle.length;
    const overlapsActive = session.items.some(
      (it) => it.active && start < it.end && end > it.start,
    );
    if (overlapsActive) {
      setManualError('Selection overlaps an existing active redaction item.');
      return;
    }
    try {
      onAddManual(start, end, manualCategory);
      setManualText('');
      setHighlightedLine(lineNumberAt(lineStarts, start));
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Selection overlaps an existing item.');
    }
  };

  return (
    <section className="diff-workbench" aria-label="Side-by-side diff and suggestions review">
      <div className="diff-toolbar">
        <div className="diff-mode-bar" role="radiogroup" aria-label="Redaction mode">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={markerStyle === opt.id}
              className="diff-mode-pill"
              onClick={() => onMarkerStyleChange(opt.id)}
              title={`Preview: ${opt.example}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="diff-toolbar__filters">
          <label className="diff-checkbox-label">
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(e) => setChangedOnly(e.target.checked)}
            />
            <span>Changed lines only</span>
          </label>
          <span>
            {visibleRows.length} / {session.diffRows.length} lines
          </span>
        </div>
      </div>

      <div className="diff-workbench-body">
        <div className="diff-grid" onMouseUp={handleCaptureSelection}>
          <div className="diff-pane" aria-label="Original input">
            <div className="diff-pane__header">
              <span>Original Input</span>
              <span>{session.doc.fileName}</span>
            </div>
            <div className="diff-pane__lines">
              {visibleRows.length === 0 ? (
                <div className="diff-row">
                  <span className="diff-line-no">—</span>
                  <span className="diff-line-text">No changed lines match the current filter.</span>
                </div>
              ) : (
                visibleRows.map((row, rowIdx) => (
                  <div
                    key={`orig-${row.lineNumber}`}
                    style={{ '--row-index': rowIdx } as CSSProperties}
                    className={`diff-row ${row.hasChanges ? 'has-changes' : ''} ${
                      highlightedLine === row.lineNumber ? 'is-highlighted' : ''
                    }`}
                  >
                    <span className="diff-line-no">{row.lineNumber}</span>
                    <span className="diff-line-text">
                      {row.originalSegments.length === 0
                        ? ' '
                        : row.originalSegments.map(renderSegment)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="diff-pane diff-pane--sanitized" aria-label="Sanitized output">
            <div className="diff-pane__header">
              <span>Sanitized Output</span>
              <span>{markerStyle}</span>
            </div>
            <div key={`san-lines-${markerStyle}`} className="diff-pane__lines diff-pane__lines--morph">
              {visibleRows.length === 0 ? (
                <div className="diff-row">
                  <span className="diff-line-no">—</span>
                  <span className="diff-line-text">No sanitized changes on visible lines.</span>
                </div>
              ) : (
                visibleRows.map((row, rowIdx) => (
                  <div
                    key={`san-${row.lineNumber}`}
                    style={{ '--row-index': rowIdx } as CSSProperties}
                    className={`diff-row ${row.hasChanges ? 'has-changes' : ''} ${
                      highlightedLine === row.lineNumber ? 'is-highlighted' : ''
                    }`}
                  >
                    <span className="diff-line-no">{row.lineNumber}</span>
                    <span className="diff-line-text">
                      {row.sanitizedSegments.length === 0
                        ? ' '
                        : row.sanitizedSegments.map(renderSegment)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <aside className="suggestions-sidebar" aria-label="Suggestions and manual review">
          <div className="suggestions-sidebar__header">
            <h3 className="suggestions-sidebar__title">
              Suggestions ({session.items.filter((i) => i.active).length}/{session.items.length})
            </h3>
            {onResetManual && hasOverrides && (
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm"
                onClick={() => {
                  setManualError(null);
                  onResetManual();
                }}
              >
                Reset Overrides
              </button>
            )}
          </div>

          {categorySummary.length > 0 && (
            <div className="suggestions-cats" role="group" aria-label="Category toggles">
              {categorySummary.map(([cat, counts]) => {
                const allActive = counts.active === counts.total;
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={allActive}
                    className={`cat-toggle-chip ${counts.active === 0 ? 'is-muted' : ''}`}
                    onClick={() => onToggleCategory(cat, !allActive)}
                  >
                    <span>{cat}</span>
                    <span>
                      {counts.active}/{counts.total}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="suggestions-body-grid">
            <div className="suggestions-list-wrap">
              {session.items.length === 0 ? (
                <p className="rule-row__note">
                  No automatic PII matches found. Add a manual redaction beside if needed.
                </p>
              ) : (
                <ul className="suggestions-list">
                  {session.items.map((item) => (
                    <li
                      key={item.id}
                      className={`suggestion-item ${item.active ? '' : 'is-inactive'} ${
                        selectedItemId === item.id ? 'is-selected' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="suggestion-check"
                        checked={item.active}
                        aria-label={`Toggle redaction for ${item.category}: ${item.original}`}
                        onChange={() => handleToggleItemSafe(item.id)}
                      />
                      <div className="suggestion-item__body">
                        <button
                          type="button"
                          className="suggestion-item__jump"
                          onClick={() => handleJumpToItem(item)}
                          title={`Jump to line ${lineNumberAt(lineStarts, item.start)}`}
                        >
                          {item.original}
                        </button>
                        <div className="suggestion-item__meta">
                          <span className="pii-pill__tag">{item.category}</span>
                          <span>→ {previewLabel(item, markerStyle)}</span>
                          {item.origin === 'manual' && <span>· manual</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form className="manual-add-form" onSubmit={handleManualSubmit}>
              <h4 className="manual-add-form__title">Add Manual Redaction</h4>
              <label htmlFor="manual-pii-text" className="rule-row__note">
                Highlight text in Original Input or enter exact phrase:
              </label>
              <input
                id="manual-pii-text"
                type="text"
                className="ui-input"
                placeholder="e.g. Project Falcon"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
              />
              <div className="manual-add-form__row">
                <select
                  aria-label="Manual redaction category"
                  className="ui-select"
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as ExtendedCategory)}
                >
                  {EXTENDED_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">
                  Add
                </button>
              </div>
              {manualError && (
                <div className="ui-alert" role="alert">
                  {manualError}
                </div>
              )}
            </form>
          </div>
        </aside>
      </div>
    </section>
  );
}
