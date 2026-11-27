import type { DocumentSessionResult } from '../core/document-pipeline';

export type NavSection = 'workbench' | 'pipeline' | 'rules' | 'restore';

export interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  sessions: DocumentSessionResult[];
  activeSessionIndex: number;
  onSelectSession: (index: number) => void;
  onRemoveSession: (index: number) => void;
  onNewSession: () => void;
  onOpenPromptLog: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({
  activeSection,
  onSelectSection,
  sessions,
  activeSessionIndex,
  onSelectSession,
  onRemoveSession,
  onNewSession,
  onOpenPromptLog,
  isOpen,
  onClose,
}: SidebarProps) {
  const handleNavClick = (section: NavSection) => {
    onSelectSection(section);
    onClose();
  };

  return (
    <nav
      className={`sidebar${isOpen ? ' is-open' : ''}`}
      aria-label="Workspace navigation"
    >
      <div className="sidebar-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <span>PII Guard</span>
          <span className="brand-badge">Local</span>
        </div>
        <button
          type="button"
          className="sidebar-close-btn"
          onClick={onClose}
          aria-label="Close navigation menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="new-session-btn"
        onClick={() => {
          onNewSession();
          onClose();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>New Session</span>
      </button>

      <div className="sidebar-nav" role="list">
        <button
          type="button"
          className="nav-item"
          aria-current={activeSection === 'workbench' ? 'page' : undefined}
          onClick={() => handleNavClick('workbench')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M12 4v16" />
          </svg>
          <span>Sanitize Workbench</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={activeSection === 'pipeline' ? 'page' : undefined}
          onClick={() => handleNavClick('pipeline')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="5" cy="12" r="2.5" />
            <circle cx="19" cy="7" r="2.5" />
            <circle cx="19" cy="17" r="2.5" />
            <path d="M7.5 12H12l4.5-4M12 12l4.5 4" />
          </svg>
          <span>Pipeline Flow</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={activeSection === 'rules' ? 'page' : undefined}
          onClick={() => handleNavClick('rules')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 6h16M4 12h10M4 18h14" />
          </svg>
          <span>Rules &amp; Patterns</span>
        </button>

        <button
          type="button"
          className="nav-item"
          aria-current={activeSection === 'restore' ? 'page' : undefined}
          onClick={() => handleNavClick('restore')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span>Restore Document</span>
        </button>

        <button
          type="button"
          className="nav-item"
          onClick={() => {
            onOpenPromptLog();
            onClose();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M8 13h8M8 17h6" />
          </svg>
          <span>Prompt Log</span>
        </button>
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section-head">
        <span>Session Files</span>
        <span className="tabular-nums">{sessions.length}/10</span>
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="session-empty">No active files in session</div>
        ) : (
          sessions.map((session, idx) => {
            const activeCount = session.items.filter((it) => it.active).length;
            const isActive = idx === activeSessionIndex && activeSection === 'workbench';
            return (
              <div
                key={`${session.doc.fileName}-${idx}`}
                className={`session-item${isActive ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="session-select-btn"
                  onClick={() => {
                    onSelectSession(idx);
                    onSelectSection('workbench');
                    onClose();
                  }}
                  title={session.doc.fileName}
                >
                  <span className="session-name">{session.doc.fileName}</span>
                  <span className="session-count tabular-nums">{activeCount}</span>
                </button>
                <button
                  type="button"
                  className="session-remove-btn"
                  aria-label={`Remove ${session.doc.fileName}`}
                  onClick={() => onRemoveSession(idx)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </nav>
  );
}
