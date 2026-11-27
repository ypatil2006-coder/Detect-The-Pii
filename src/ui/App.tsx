import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { CodeBook } from '../core/codes';
import { addManualItem, toggleItem } from '../core/detector';
import {
  analyzeDocument,
  buildExportBlob,
  recomputeDocumentSession,
  type DocumentSessionResult,
} from '../core/document-pipeline';
import { getEffectivePatterns, loadConfig } from '../core/pattern-store';
import type { PipelineStageTiming } from '../core/pipeline';
import { applyRedactions } from '../core/redactor';
import {
  createPseudonymState,
  type ExtendedCategory,
  type LoadedDocument,
  type MarkerStyle,
  type Pattern,
  type RedactionItem,
} from '../core/types';
import { buildArchive, validateBatchFiles } from '../formats/batch';
import { ACCEPT_ATTR, loadDocument } from '../formats/index';
import {
  buildSampleDocxFile,
  buildSamplePdfFile,
  buildSampleXlsxFile,
  getSampleById,
  MARKDOWN_SAMPLE_TEXT,
} from '../formats/samples';
import { AuditPanel } from './AuditPanel';
import { DiffSuggestionsView } from './DiffSuggestionsView';
import { LandingComposer, type SampleTriggerId } from './LandingComposer';
import { PipelineFlow } from './PipelineFlow';
import { ProgressChecklist } from './ProgressChecklist';
import { PromptLogModal } from './PromptLogModal';
import { RulesRestorePanel } from './RulesRestorePanel';
import { Sidebar, type NavSection } from './Sidebar';

type ThemeMode = 'dark' | 'light';
const THEME_STORAGE_KEY = 'pii-sanitizer-theme';

function readInitialTheme(): ThemeMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
    }
  } catch {
    // Ignore storage restrictions
  }
  return 'dark';
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const DEFAULT_IDLE_STAGES: PipelineStageTiming[] = [
  { id: 'parse', label: 'Input Parse', durationMs: 0, matchedCount: 0 },
  { id: 'scan', label: 'Pattern Scan', durationMs: 0, matchedCount: 0 },
  { id: 'luhn', label: 'Luhn Card Check', durationMs: 0, matchedCount: 0, rejectedCount: 0 },
  { id: 'verhoeff', label: 'Verhoeff Aadhaar Check', durationMs: 0, matchedCount: 0, rejectedCount: 0 },
  { id: 'validators', label: 'PAN / IP / Email / Phone', durationMs: 0, matchedCount: 0 },
  { id: 'redact', label: 'Mode Operator', durationMs: 0, matchedCount: 0 },
  { id: 'diff', label: 'Diff & Export', durationMs: 0, matchedCount: 0 },
];

export function App() {
  const [patterns, setPatterns] = useState<Pattern[]>(() =>
    getEffectivePatterns(loadConfig()),
  );
  const [markerStyle, setMarkerStyle] = useState<MarkerStyle>('pseudonym');
  const [sessions, setSessions] = useState<DocumentSessionResult[]>([]);
  const [activeSessionIndex, setActiveSessionIndex] = useState(0);
  const [activeSection, setActiveSection] = useState<NavSection>('workbench');
  const [draftText, setDraftText] = useState('');
  const [quickPasteText, setQuickPasteText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [runId, setRunId] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false);
  const [auditOpen, setAuditOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth > 960,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [promptLogOpen, setPromptLogOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'light' ? '#f8f9fb' : '#121214');
    }
    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage restrictions
    }
  }, [theme]);

  const handleToggleTheme = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
      const prefersReduced =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const docWithTransition = document as Document & {
        startViewTransition?: (cb: () => void) => { ready: Promise<void> };
      };

      if (prefersReduced || typeof docWithTransition.startViewTransition !== 'function') {
        setTheme(nextTheme);
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const x = rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth - 48;
      const y = rect.height > 0 ? rect.top + rect.height / 2 : 24;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      try {
        const transition = docWithTransition.startViewTransition(() => {
          flushSync(() => {
            setTheme(nextTheme);
          });
        });
        transition.ready
          .then(() => {
            document.documentElement.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 280,
                easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
                pseudoElement: '::view-transition-new(root)',
              },
            );
          })
          .catch(() => {
            // Fallback cleanly if animation is skipped
          });
      } catch {
        setTheme(nextTheme);
      }
    },
    [theme],
  );

  const inlineUploadRef = useRef<HTMLInputElement | null>(null);

  const activeSession = sessions[activeSessionIndex] ?? null;

  useEffect(() => {
    if (!hasUnsavedWork || sessions.length === 0) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedWork, sessions.length]);

  const runDocuments = useCallback(
    (docs: LoadedDocument[], targetPatterns: Pattern[] = patterns, targetStyle: MarkerStyle = markerStyle) => {
      setErrorMessage(null);
      setIsAnalyzing(true);
      setActiveStageIndex(0);

      const sharedState = createPseudonymState();
      const nextSessions = docs.map((doc) =>
        analyzeDocument(doc, targetPatterns, targetStyle, sharedState),
      );

      setSessions(nextSessions);
      setActiveSessionIndex(0);
      setActiveSection('workbench');
      setHasUnsavedWork(true);
      setRunId((id) => id + 1);

      const stageCount = nextSessions[0]?.stages.length ?? DEFAULT_IDLE_STAGES.length;
      setActiveStageIndex(stageCount - 1);
      setIsAnalyzing(false);
    },
    [markerStyle, patterns],
  );

  const handleRunText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const doc: LoadedDocument = {
        fileName: 'pasted-input.txt',
        format: 'txt',
        text,
        handle: null,
      };
      runDocuments([doc]);
    },
    [runDocuments],
  );

  const handleUploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const batchCheck = validateBatchFiles(files);
      if (!batchCheck.ok) {
        setErrorMessage(batchCheck.error);
        return;
      }

      setErrorMessage(null);
      setIsAnalyzing(true);
      try {
        const docs: LoadedDocument[] = [];
        for (const file of files) {
          docs.push(await loadDocument(file));
        }
        runDocuments(docs);
      } catch (err) {
        setIsAnalyzing(false);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to parse uploaded document.');
      }
    },
    [runDocuments],
  );

  const handleLoadSample = useCallback(
    async (sampleId: SampleTriggerId) => {
      setErrorMessage(null);
      setIsAnalyzing(true);
      try {
        if (sampleId === 'docx') {
          const file = await buildSampleDocxFile();
          const doc = await loadDocument(file);
          runDocuments([doc]);
          return;
        }
        if (sampleId === 'xlsx') {
          const file = await buildSampleXlsxFile();
          const doc = await loadDocument(file);
          runDocuments([doc]);
          return;
        }
        if (sampleId === 'pdf') {
          const file = await buildSamplePdfFile();
          const doc = await loadDocument(file);
          runDocuments([doc]);
          return;
        }
        if (sampleId === 'markdown') {
          const doc: LoadedDocument = {
            fileName: 'incident-brief.md',
            format: 'md',
            text: MARKDOWN_SAMPLE_TEXT,
            handle: null,
          };
          setDraftText(MARKDOWN_SAMPLE_TEXT);
          runDocuments([doc]);
          return;
        }
        const preset = getSampleById(sampleId);
        const ext = preset.kind === 'csv' ? 'csv' : 'txt';
        const doc: LoadedDocument = {
          fileName: `${preset.id}.${ext}`,
          format: preset.kind,
          text: preset.content,
          handle: null,
        };
        setDraftText(preset.content);
        runDocuments([doc]);
      } catch (err) {
        setIsAnalyzing(false);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load sample dataset.');
      }
    },
    [runDocuments],
  );

  const handleMarkerStyleChange = useCallback(
    (nextStyle: MarkerStyle) => {
      setMarkerStyle(nextStyle);
      setSessions((prev) => {
        if (prev.length === 0) return prev;
        const sharedState = createPseudonymState();
        return prev.map((session) =>
          recomputeDocumentSession(session.doc, session.items, nextStyle, sharedState),
        );
      });
    },
    [],
  );

  const updateActiveSessionItems = useCallback(
    (mutator: (items: RedactionItem[], doc: LoadedDocument) => RedactionItem[]) => {
      setErrorMessage(null);
      setSessions((prev) => {
        const current = prev[activeSessionIndex];
        if (!current) return prev;
        try {
          const cloned = current.items.map((it) => ({ ...it }));
          const nextItems = mutator(cloned, current.doc);
          const next = [...prev];
          const sharedState = createPseudonymState();
          next[activeSessionIndex] = recomputeDocumentSession(
            current.doc,
            nextItems,
            markerStyle,
            sharedState,
          );
          setHasUnsavedWork(true);
          return next;
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : 'Could not update redaction item.');
          return prev;
        }
      });
    },
    [activeSessionIndex, markerStyle],
  );

  const handleToggleItem = useCallback(
    (id: string) => {
      updateActiveSessionItems((items) => {
        toggleItem(items, id);
        return items;
      });
    },
    [updateActiveSessionItems],
  );

  const handleToggleCategory = useCallback(
    (cat: ExtendedCategory, active: boolean) => {
      updateActiveSessionItems((items) => {
        for (const it of items) {
          if (it.category !== cat || it.active === active) continue;
          if (!active) {
            it.active = false;
          } else {
            const overlaps = items.some(
              (other) => other.active && other.id !== it.id && it.start < other.end && it.end > other.start,
            );
            if (!overlaps) {
              it.active = true;
            }
          }
        }
        return items;
      });
    },
    [updateActiveSessionItems],
  );

  const handleAddManual = useCallback(
    (start: number, end: number, cat: ExtendedCategory) => {
      updateActiveSessionItems((items, doc) => {
        const book = new CodeBook();
        addManualItem(items, doc.text, start, end, cat, book);
        return items;
      });
    },
    [updateActiveSessionItems],
  );

  const handleResetManual = useCallback(() => {
    setSessions((prev) => {
      const current = prev[activeSessionIndex];
      if (!current) return prev;
      const autoOnly = current.items.filter((it) => it.origin !== 'manual').map((it) => ({ ...it, active: true }));
      const next = [...prev];
      next[activeSessionIndex] = recomputeDocumentSession(
        current.doc,
        autoOnly,
        markerStyle,
        createPseudonymState(),
      );
      return next;
    });
  }, [activeSessionIndex, markerStyle]);

  const handleUpdatePatterns = useCallback(
    (nextPatterns: Pattern[]) => {
      setPatterns(nextPatterns);
      setSessions((prev) => {
        if (prev.length === 0) return prev;
        const sharedState = createPseudonymState();
        return prev.map((s) => analyzeDocument(s.doc, nextPatterns, markerStyle, sharedState));
      });
    },
    [markerStyle],
  );

  const handleRemoveSession = useCallback((index: number) => {
    setSessions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setActiveSessionIndex((curr) => (curr >= next.length ? Math.max(0, next.length - 1) : curr));
      if (next.length === 0) {
        setHasUnsavedWork(false);
      }
      return next;
    });
  }, []);

  const handleNewSession = useCallback(() => {
    setSessions([]);
    setActiveSessionIndex(0);
    setActiveSection('workbench');
    setDraftText('');
    setQuickPasteText('');
    setErrorMessage(null);
    setHasUnsavedWork(false);
  }, []);

  const handleDownloadSanitized = useCallback(async () => {
    if (!activeSession) return;
    try {
      const exported = await buildExportBlob(activeSession, markerStyle);
      triggerDownload(exported.sanitizedBlob, exported.fileName);
      setHasUnsavedWork(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to build sanitized export.');
    }
  }, [activeSession, markerStyle]);

  const handleDownloadMapping = useCallback(async () => {
    if (!activeSession) return;
    try {
      const exported = await buildExportBlob(activeSession, markerStyle);
      if (!exported.mappingCsv) {
        setErrorMessage('Mapping CSV is only generated in Consistent Pseudonym mode when entities are active.');
        return;
      }
      triggerDownload(
        new Blob([exported.mappingCsv], { type: 'text/csv;charset=utf-8' }),
        exported.mappingFileName,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to export mapping CSV.');
    }
  }, [activeSession, markerStyle]);

  const handleExportBatch = useCallback(async () => {
    if (sessions.length === 0) return;
    try {
      const entries = sessions.map((s) => ({ doc: s.doc, items: s.items }));
      const { blob } = await buildArchive(
        entries,
        (text, items, style) => {
          const res = applyRedactions(text, items, style);
          return { edits: res.edits, mapping: res.mapping };
        },
        { style: markerStyle },
      );
      triggerDownload(blob, 'sanitized-batch.zip');
      setHasUnsavedWork(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create batch ZIP archive.');
    }
  }, [markerStyle, sessions]);

  const handleQuickPasteSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!quickPasteText.trim()) return;
    handleRunText(quickPasteText);
    setQuickPasteText('');
  };

  const liveAnnouncement = useMemo(() => {
    if (isAnalyzing) return 'Analyzing document locally in browser.';
    if (!activeSession) return 'Ready. All sanitization runs locally in your browser.';
    const activeCount = activeSession.items.filter((it) => it.active).length;
    return `${activeSession.doc.fileName}: ${activeCount} active PII entities detected in ${activeSession.durationMs.toFixed(1)} ms under ${markerStyle} mode.`;
  }, [activeSession, isAnalyzing, markerStyle]);

  const activeStages = activeSession?.stages ?? DEFAULT_IDLE_STAGES;
  const activeTotalMs = activeSession?.durationMs ?? 0;

  const isLandingView = activeSection === 'workbench' && !activeSession;
  const showAuditPanel = Boolean(activeSession) && auditOpen;

  return (
    <div className={`app-shell${showAuditPanel ? ' with-audit' : ''}`}>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        sessions={sessions}
        activeSessionIndex={activeSessionIndex}
        onSelectSession={setActiveSessionIndex}
        onRemoveSession={handleRemoveSession}
        onNewSession={handleNewSession}
        onOpenPromptLog={() => setPromptLogOpen(true)}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main id="main-content" className="main-column">
        <header className={`topbar${isLandingView ? ' topbar--minimal' : ''}`}>
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => {
                if (typeof window !== 'undefined' && window.innerWidth <= 960) {
                  setAuditOpen(false);
                }
                setSidebarOpen(true);
              }}
              aria-label="Open workspace navigation"
              aria-expanded={sidebarOpen}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>

            {!isLandingView && (
              <h1 className="topbar-title">
                {activeSection === 'rules'
                  ? 'Rules & Custom Patterns'
                  : activeSection === 'restore'
                    ? 'Restore Sanitized Document'
                    : activeSection === 'pipeline'
                      ? 'Detection Pipeline Flow'
                      : activeSession
                        ? activeSession.doc.fileName
                        : 'New Sanitization Session'}
              </h1>
            )}

            {activeSession && activeSection === 'workbench' && (
              <span className={`format-pill${activeSession.doc.ocr ? ' is-ocr' : ''}`}>
                {activeSession.doc.ocr
                  ? `${activeSession.doc.format} · OCR`
                  : activeSession.doc.format}
              </span>
            )}
          </div>

          <div className="topbar-actions">
            {activeSession && (activeSection === 'workbench' || activeSection === 'pipeline') && (
              <div className="segmented-tabs" role="tablist" aria-label="Workspace view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSection === 'workbench'}
                  className={`segmented-tab${activeSection === 'workbench' ? ' is-active' : ''}`}
                  onClick={() => setActiveSection('workbench')}
                >
                  Diff &amp; Review
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSection === 'pipeline'}
                  className={`segmented-tab${activeSection === 'pipeline' ? ' is-active' : ''}`}
                  onClick={() => setActiveSection('pipeline')}
                >
                  Pipeline Flow
                </button>
              </div>
            )}

            {activeSession && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleDownloadSanitized}
                >
                  Download Sanitized
                </button>
                {markerStyle === 'pseudonym' && activeSession.mappings.length > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={handleDownloadMapping}
                  >
                    Mapping CSV
                  </button>
                )}
                {sessions.length > 1 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={handleExportBatch}
                  >
                    Export Batch ZIP
                  </button>
                )}
              </>
            )}

            {activeSession && (
              <button
                type="button"
                className="btn"
                aria-expanded={auditOpen}
                onClick={() => {
                  setAuditOpen((open) => {
                    const next = !open;
                    if (next && typeof window !== 'undefined' && window.innerWidth <= 960) {
                      setSidebarOpen(false);
                    }
                    return next;
                  });
                }}
              >
                {auditOpen ? 'Hide Audit' : 'Show Audit'}
              </button>
            )}

            <button
              type="button"
              role="switch"
              aria-checked={theme === 'light'}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              className={`theme-toggle${theme === 'light' ? ' is-light' : ''}`}
              onClick={handleToggleTheme}
            >
              <span className="theme-toggle__thumb" aria-hidden="true" />
              <span className={`theme-toggle__option${theme === 'dark' ? ' is-active' : ''}`}>
                <svg className="theme-toggle__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
                <span>Dark</span>
              </span>
              <span className={`theme-toggle__option${theme === 'light' ? ' is-active' : ''}`}>
                <svg className="theme-toggle__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
                <span>Light</span>
              </span>
            </button>
          </div>
        </header>

        <div className="sr-only" role="status" aria-live="polite">
          {liveAnnouncement}
        </div>

        <div className="workbench-scroll">
          {errorMessage && (
            <div className="error-banner" role="alert">
              <span>{errorMessage}</span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setErrorMessage(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {activeSection === 'rules' || activeSection === 'restore' ? (
            <RulesRestorePanel
              patterns={patterns}
              onUpdatePatterns={handleUpdatePatterns}
              activeTab={activeSection}
              sessions={sessions}
              onExportBatch={handleExportBatch}
            />
          ) : activeSection === 'pipeline' ? (
            <PipelineFlow
              stages={activeStages}
              totalMs={activeTotalMs}
              isRunning={isAnalyzing}
              runId={runId}
            />
          ) : !activeSession ? (
            <LandingComposer
              draftText={draftText}
              onDraftChange={setDraftText}
              markerStyle={markerStyle}
              onMarkerStyleChange={handleMarkerStyleChange}
              onRunText={handleRunText}
              onUploadFiles={handleUploadFiles}
              onLoadSample={handleLoadSample}
              isProcessing={isAnalyzing}
            />
          ) : (
            <>
              <ProgressChecklist
                stages={activeStages}
                activeIndex={activeStageIndex}
                completed={!isAnalyzing}
                totalMs={activeTotalMs}
              />

              <DiffSuggestionsView
                session={activeSession}
                markerStyle={markerStyle}
                onMarkerStyleChange={handleMarkerStyleChange}
                onToggleItem={handleToggleItem}
                onToggleCategory={handleToggleCategory}
                onAddManual={handleAddManual}
                onResetManual={handleResetManual}
              />

              <form className="inline-composer-bar" onSubmit={handleQuickPasteSubmit}>
                <input
                  ref={inlineUploadRef}
                  type="file"
                  multiple
                  accept={ACCEPT_ATTR}
                  className="sr-only"
                  aria-label="Upload another file"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleUploadFiles(e.target.files);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => inlineUploadRef.current?.click()}
                >
                  + Upload
                </button>
                <label htmlFor="quick-paste-input" className="sr-only">
                  Paste new text to sanitize
                </label>
                <input
                  id="quick-paste-input"
                  type="text"
                  className="inline-composer-input"
                  value={quickPasteText}
                  onChange={(e) => setQuickPasteText(e.target.value)}
                  placeholder="Paste new text or upload additional files to analyze locally..."
                />
                <button
                  type="submit"
                  className="btn btn-contrast"
                  disabled={!quickPasteText.trim()}
                >
                  Run
                </button>
              </form>
            </>
          )}
        </div>
      </main>

      {showAuditPanel && (
        <AuditPanel
          session={activeSession}
          markerStyle={markerStyle}
          onClose={() => setAuditOpen(false)}
        />
      )}

      <PromptLogModal open={promptLogOpen} onClose={() => setPromptLogOpen(false)} />
    </div>
  );
}
