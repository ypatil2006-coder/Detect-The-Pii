import type { CSSProperties } from 'react';
import type { DocumentSessionResult } from '../core/document-pipeline';
import { EXTENDED_CATEGORIES, type ExtendedCategory, type MarkerStyle } from '../core/types';
import { formatLimitations } from '../formats/index';

export interface AuditPanelProps {
  session: DocumentSessionResult | null;
  markerStyle: MarkerStyle;
  isAnalyzing?: boolean;
  runId?: number;
  onClose?: () => void;
}

export function AuditPanel({
  session,
  markerStyle,
  isAnalyzing = false,
  runId = 0,
  onClose,
}: AuditPanelProps) {
  if (!session) {
    return (
      <aside className="audit-panel" aria-label="Audit Dashboard">
        <div className="audit-panel-header">
          <h2 className="audit-panel-title">Audit Score</h2>
          {onClose && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              aria-label="Close audit panel"
            >
              Close
            </button>
          )}
        </div>
        <div className="audit-callout">
          <span className="audit-callout-title">Awaiting Input</span>
          <span className="audit-callout-sub">
            Paste text, upload a file, or load a sample dataset to inspect category counts, Luhn/Verhoeff rejections, and pseudonym mappings.
          </span>
        </div>
      </aside>
    );
  }

  const activeItems = session.items.filter((it) => it.active);
  const suppressedCount = session.items.length - activeItems.length;

  const countsByCategory = new Map<ExtendedCategory, number>();
  for (const cat of EXTENDED_CATEGORIES) {
    countsByCategory.set(cat, 0);
  }
  for (const item of activeItems) {
    countsByCategory.set(item.category, (countsByCategory.get(item.category) ?? 0) + 1);
  }

  const activeDistribution = EXTENDED_CATEGORIES.map((cat) => ({
    category: cat,
    count: countsByCategory.get(cat) ?? 0,
  })).filter((row) => row.count > 0);

  const maxCategoryCount = Math.max(1, ...activeDistribution.map((d) => d.count));
  const limitationNote = formatLimitations(session.doc.format, session.doc.ocr);

  return (
    <aside className="audit-panel" aria-label="Audit Dashboard">
      <div className="audit-panel-header">
        <h2 className="audit-panel-title">Audit Score</h2>
        {onClose && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Collapse audit panel"
          >
            Hide
          </button>
        )}
      </div>

      <div key={`${runId}-${isAnalyzing ? 'scan' : 'ready'}`} className={`audit-content${isAnalyzing ? ' is-analyzing' : ' is-leasing'}`}>
        <div className="audit-callout">
          <span className="audit-callout-title">
            <span className="status-dot" aria-hidden="true" />
            {isAnalyzing ? 'Running Local Checks…' : 'Local Browser Execution'}
          </span>
          <span className="audit-callout-sub tabular-nums">
            Completed in {session.durationMs.toFixed(1)} ms · 0 bytes transmitted
          </span>
        </div>

        {limitationNote && (
          <div className="audit-notice" role="note">
            {limitationNote}
          </div>
        )}

        <div className="audit-stat-grid">
          <div className="audit-stat-card" style={{ '--stagger': 0 } as CSSProperties}>
            <span className="audit-stat-label">Active Entities</span>
            <span className="audit-stat-value">{activeItems.length}</span>
            <span className="audit-stat-meta">Mode: {markerStyle}</span>
          </div>
          <div className="audit-stat-card" style={{ '--stagger': 1 } as CSSProperties}>
            <span className="audit-stat-label">Suppressed</span>
            <span className="audit-stat-value">{suppressedCount}</span>
            <span className="audit-stat-meta">User overrides</span>
          </div>
          <div className="audit-stat-card" style={{ '--stagger': 2 } as CSSProperties}>
            <span className="audit-stat-label">Rejected Cards</span>
            <span className="audit-stat-value">{session.stats.rejectedCreditCards}</span>
            <span className="audit-stat-meta">Failed Luhn mod-10</span>
          </div>
          <div className="audit-stat-card" style={{ '--stagger': 3 } as CSSProperties}>
            <span className="audit-stat-label">Rejected Aadhaar</span>
            <span className="audit-stat-value">{session.stats.rejectedAadhaar}</span>
            <span className="audit-stat-meta">Failed Verhoeff</span>
          </div>
        </div>

        <section className="audit-section-card" aria-labelledby="dist-heading">
          <h3 id="dist-heading" className="audit-section-title">
            Category Distribution
          </h3>
          {activeDistribution.length === 0 ? (
            <div className="audit-callout-sub">No active PII entities detected.</div>
          ) : (
            <div className="dist-bars">
              {activeDistribution.map(({ category, count }, idx) => {
                const pct = Math.max(8, Math.round((count / maxCategoryCount) * 100));
                return (
                  <div
                    key={category}
                    className="dist-row"
                    style={{ '--stagger': idx } as CSSProperties}
                  >
                    <span className="dist-label" title={category}>
                      {category}
                    </span>
                    <div className="dist-track" aria-hidden="true">
                      <div className="dist-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="dist-count">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="audit-section-card" aria-labelledby="pseudonym-heading">
          <h3 id="pseudonym-heading" className="audit-section-title">
            Pseudonym &amp; Mapping Audit
          </h3>
          {session.pseudonyms.length === 0 && session.mappings.length === 0 ? (
            <div className="audit-callout-sub">
              Switch to Consistent Pseudonym mode to generate deterministic placeholders and a reversible `.mapping.csv` table.
            </div>
          ) : session.pseudonyms.length > 0 ? (
            <div className="pseudonym-list">
              {session.pseudonyms.map((entry) => (
                <div key={entry.placeholder} className="pseudonym-row">
                  <span className="pseudonym-code">{entry.placeholder}</span>
                  <span className="pseudonym-preview">{entry.maskedPreview}</span>
                  <span className="session-count tabular-nums">×{entry.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="pseudonym-list">
              {session.mappings.map((entry) => (
                <div key={entry.code} className="pseudonym-row">
                  <span className="pseudonym-code">[{entry.category}:{entry.code}]</span>
                  <span className="pseudonym-preview">Reversible entry</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
