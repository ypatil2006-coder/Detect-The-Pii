import type { PipelineStageTiming } from '../core/pipeline';

export interface ProgressChecklistProps {
  stages: PipelineStageTiming[];
  activeIndex: number;
  completed: boolean;
  totalMs: number;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '< 0.1 ms';
  if (ms < 0.1) return '< 0.1 ms';
  return `${ms.toFixed(1)} ms`;
}

/**
 * Sequential live progress checklist card modeled on Image 4's center analysis widget.
 */
export function ProgressChecklist({
  stages,
  activeIndex,
  completed,
  totalMs,
}: ProgressChecklistProps) {
  const count = stages.length;

  return (
    <section className="progress-card" aria-label="Sanitization progress checklist">
      <div className="progress-card__header">
        <div className="progress-card__identity">
          <span
            className={`progress-card__dot ${completed ? 'is-complete' : ''}`}
            aria-hidden="true"
          />
          <span>Privacy Engine</span>
        </div>
        <span className="progress-card__meta">
          {count} steps · {completed ? 'Completed' : 'Analysis'}
        </span>
      </div>

      <p className="progress-card__lead">
        {completed
          ? 'Document checks completed locally.'
          : 'Checking your document and validating PII checksums.'}
      </p>

      {stages.length === 0 ? (
        <p className="progress-card__meta">Run a scan to inspect per-stage timings.</p>
      ) : (
        <ul className="progress-list">
          {stages.map((stage, idx) => {
            const isDone = completed || idx < activeIndex;
            const isActive = !completed && idx === activeIndex;
            const stateClass = isDone ? 'is-done' : isActive ? 'is-active' : 'is-pending';

            return (
              <li key={stage.id} className={`progress-item ${stateClass}`}>
                <div className="progress-item__left">
                  <span
                    className={`progress-indicator ${
                      isDone
                        ? 'progress-indicator--done'
                        : isActive
                          ? 'progress-indicator--active'
                          : 'progress-indicator--pending'
                    }`}
                    aria-hidden="true"
                  >
                    {isDone ? '✓' : ''}
                  </span>
                  <span className="progress-item__label">{stage.label}</span>
                </div>
                <div className="progress-item__right">
                  {stage.matchedCount > 0 && <span>{stage.matchedCount} hits</span>}
                  {typeof stage.rejectedCount === 'number' && stage.rejectedCount > 0 && (
                    <span>{stage.rejectedCount} rejected</span>
                  )}
                  <span>{formatMs(stage.durationMs)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="progress-card__footer">
        <span>Total: {formatMs(totalMs)}</span>
        <span>100% browser-local · Zero egress</span>
      </div>
    </section>
  );
}
