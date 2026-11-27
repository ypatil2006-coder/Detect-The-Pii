import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { DocumentSessionResult } from '../core/document-pipeline';
import { detect } from '../core/detector';
import { newCustomId, saveConfig, validateRegex } from '../core/pattern-store';
import { applyRedactions } from '../core/redactor';
import { restore } from '../core/restorer';
import { describeRetention } from '../core/retention';
import {
  EXTENDED_CATEGORIES,
  type ExtendedCategory,
  type LoadedDocument,
  type MappingEntry,
  type Pattern,
  type PatternConfig,
  type Retention,
} from '../core/types';
import { buildArchive, MAX_BATCH_FILES } from '../formats/batch';
import { parseMapping, serializeMapping } from '../formats/csv';
import { loadDocument, outputFileName, restoreDocument } from '../formats/index';
import { readBlobText } from '../formats/segments';

export interface RulesRestorePanelProps {
  patterns: Pattern[];
  onUpdatePatterns: (patterns: Pattern[]) => void;
  activeTab: 'rules' | 'restore';
  sessions: DocumentSessionResult[];
  onExportBatch?: () => void;
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toPatternConfig(patterns: Pattern[]): PatternConfig {
  const disabledBuiltins = patterns
    .filter((p) => p.source === 'builtin' && !p.enabled)
    .map((p) => p.id);
  const customPatterns = patterns
    .filter((p) => p.source === 'custom')
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      regex: p.regex,
      example: p.example,
      enabled: p.enabled,
    }));
  const retention: Record<string, Retention> = {};
  for (const p of patterns) {
    if (p.retention && p.retention.mode !== 'none') {
      retention[p.id] = p.retention;
    }
  }
  return {
    version: 1,
    disabledBuiltins,
    customPatterns,
    ...(Object.keys(retention).length > 0 ? { retention } : {}),
  };
}

/**
 * Built-in & custom RegExp rules manager with live pattern tester,
 * offline Document Restore workflow (sanitized file + .mapping.csv),
 * and multi-file batch ZIP export controls.
 */
export function RulesRestorePanel({
  patterns,
  onUpdatePatterns,
  activeTab,
  sessions,
  onExportBatch,
}: RulesRestorePanelProps) {
  const [tab, setTab] = useState<'rules' | 'restore'>(activeTab);
  useEffect(() => {
    setTab(activeTab);
  }, [activeTab]);

  // Custom RegExp builder & live tester state
  const [ruleName, setRuleName] = useState('');
  const [ruleCategory, setRuleCategory] = useState<ExtendedCategory>('CUSTOM');
  const [ruleRegex, setRuleRegex] = useState('');
  const [ruleExample, setRuleExample] = useState('');
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [testInput, setTestInput] = useState(
    'Contact rahul@acme.example, PAN ABCPA1234F, Ref ID EMP-9042',
  );

  // Document restore state
  const [restoreDoc, setRestoreDoc] = useState<LoadedDocument | null>(null);
  const [sanitizedInput, setSanitizedInput] = useState('');
  const [mappingEntries, setMappingEntries] = useState<MappingEntry[]>([]);
  const [mappingStatus, setMappingStatus] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const previewPatterns = useMemo(() => {
    const err = ruleRegex.trim() ? validateRegex(ruleRegex) : 'empty';
    if (err !== null) return patterns;
    return [
      ...patterns,
      {
        id: 'preview-rule',
        name: ruleName.trim() || 'Preview Rule',
        category: ruleCategory,
        source: 'custom' as const,
        regex: ruleRegex,
        example: ruleExample,
        enabled: true,
      },
    ];
  }, [patterns, ruleCategory, ruleExample, ruleName, ruleRegex]);

  const liveTestHits = useMemo(
    () => detect(testInput, previewPatterns),
    [previewPatterns, testInput],
  );

  const restoreOutcome = useMemo(() => {
    if (!sanitizedInput || mappingEntries.length === 0) return null;
    return restore(sanitizedInput, mappingEntries);
  }, [mappingEntries, sanitizedInput]);

  const commitPatterns = (next: Pattern[]) => {
    saveConfig(toPatternConfig(next));
    onUpdatePatterns(next);
  };

  const handleToggleRule = (id: string) => {
    commitPatterns(
      patterns.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  };

  const handleRetentionChange = (id: string, mode: Retention['mode']) => {
    const nextRetention: Retention =
      mode === 'preview'
        ? { mode: 'preview' }
        : mode === 'ends'
          ? { mode: 'ends', head: 2, tail: 2 }
          : mode === 'delim'
            ? { mode: 'delim', delimiter: '@', side: 'after' }
            : { mode: 'none' };

    commitPatterns(
      patterns.map((p) =>
        p.id === id
          ? { ...p, retention: nextRetention.mode === 'none' ? undefined : nextRetention }
          : p,
      ),
    );
  };

  const handleAddCustomRule = (e: FormEvent) => {
    e.preventDefault();
    setRuleError(null);
    if (!ruleName.trim()) {
      setRuleError('Rule name is required.');
      return;
    }
    const regexErr = validateRegex(ruleRegex);
    if (regexErr) {
      setRuleError(regexErr);
      return;
    }
    const created: Pattern = {
      id: newCustomId(),
      name: ruleName.trim(),
      category: ruleCategory,
      source: 'custom',
      regex: ruleRegex,
      example: ruleExample.trim(),
      enabled: true,
    };
    commitPatterns([...patterns, created]);
    setRuleName('');
    setRuleRegex('');
    setRuleExample('');
  };

  const handleRemoveCustomRule = (id: string) => {
    commitPatterns(patterns.filter((p) => p.id !== id));
  };

  const handleSanitizedFileUpload = async (file: File | null) => {
    if (!file) return;
    setRestoreError(null);
    try {
      const loaded = await loadDocument(file);
      setRestoreDoc(loaded);
      setSanitizedInput(loaded.text);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Unable to read sanitized file.');
    }
  };

  const handleMappingFileUpload = async (file: File | null) => {
    if (!file) return;
    setRestoreError(null);
    setMappingStatus(null);
    try {
      const csvText = await readBlobText(file);
      const parsed = parseMapping(csvText);
      if (parsed.errors.length > 0) {
        setRestoreError(parsed.errors.join(' '));
        return;
      }
      setMappingEntries(parsed.entries);
      setMappingStatus(`Loaded ${parsed.entries.length} mapping entries from ${file.name}.`);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Unable to parse mapping CSV.');
    }
  };

  const handleUseSessionMapping = () => {
    const withMappings = sessions.find((s) => s.mappings.length > 0);
    if (!withMappings) return;
    setRestoreError(null);
    setRestoreDoc(null);
    setSanitizedInput(withMappings.sanitizedText);
    setMappingEntries(withMappings.mappings);
    setMappingStatus(
      `Loaded ${withMappings.mappings.length} mapping entries from ${withMappings.doc.fileName}.`,
    );
  };

  const handleDownloadRestored = async () => {
    if (!restoreOutcome) return;
    if (restoreDoc && restoreDoc.format !== 'txt' && restoreDoc.format !== 'md' && restoreDoc.format !== 'csv') {
      const blob = await restoreDocument(restoreDoc, restoreOutcome.edits);
      triggerDownload(blob, outputFileName(restoreDoc.fileName, 'restored'));
      return;
    }
    const name = restoreDoc ? outputFileName(restoreDoc.fileName, 'restored') : 'document.restored.txt';
    const blob = new Blob([restoreOutcome.restoredText], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, name);
  };

  const handleInternalBatchExport = async () => {
    if (onExportBatch) {
      onExportBatch();
      return;
    }
    if (sessions.length === 0) return;
    setBatchBusy(true);
    setBatchStatus(null);
    try {
      const entries = sessions.slice(0, MAX_BATCH_FILES).map((s) => ({
        doc: s.doc,
        items: s.items,
      }));
      const merged = sessions.flatMap((s) => s.mappings);
      const { blob, manifest } = await buildArchive(
        entries,
        (text, items, style) => {
          const res = applyRedactions(text, items, style);
          return { edits: res.edits, mapping: res.mapping };
        },
        { merged, style: 'pseudonym' },
      );
      triggerDownload(blob, 'sanitized-batch.zip');
      setBatchStatus(`Exported ${manifest.length} file(s) with manifest.csv.`);
    } catch (err) {
      setBatchStatus(err instanceof Error ? err.message : 'Batch export failed.');
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <section className="rules-restore-panel" aria-label="Detection rules and document restore">
      <div className="rules-tabs" role="tablist" aria-label="Rules and Restore views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'rules'}
          className="rules-tab"
          onClick={() => setTab('rules')}
        >
          Detection Rules ({patterns.filter((p) => p.enabled).length}/{patterns.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'restore'}
          className="rules-tab"
          onClick={() => setTab('restore')}
        >
          Document Restore
        </button>
      </div>

      {tab === 'rules' ? (
        <div className="rules-layout">
          <div className="rules-card">
            <h3 className="rules-card__title">Built-in & Custom Rules</h3>
            <ul className="rule-list">
              {patterns.map((pattern) => (
                <li key={pattern.id} className="rule-row">
                  <div className="rule-row__top">
                    <label className="rule-row__name">
                      <input
                        type="checkbox"
                        checked={pattern.enabled}
                        onChange={() => handleToggleRule(pattern.id)}
                      />
                      <span>{pattern.name}</span>
                      <span className="pipeline-badge">{pattern.category}</span>
                      {pattern.group && (
                        <span className="pipeline-badge">{pattern.group.toUpperCase()}</span>
                      )}
                    </label>
                    {pattern.source === 'custom' && (
                      <button
                        type="button"
                        className="ui-btn ui-btn--ghost ui-btn--sm"
                        onClick={() => handleRemoveCustomRule(pattern.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {pattern.note && <div className="rule-row__note">{pattern.note}</div>}
                  <div className="rule-row__controls">
                    <label className="rule-row__note" htmlFor={`ret-${pattern.id}`}>
                      Partial retention:
                    </label>
                    <select
                      id={`ret-${pattern.id}`}
                      className="ui-select"
                      style={{ width: 'auto', minWidth: '170px' }}
                      value={pattern.retention?.mode ?? 'none'}
                      onChange={(e) =>
                        handleRetentionChange(pattern.id, e.target.value as Retention['mode'])
                      }
                    >
                      <option value="none">Hide all</option>
                      <option value="preview">Partial mask (standard)</option>
                      <option value="ends">Keep first 2 + last 2</option>
                      <option value="delim">Keep after @</option>
                    </select>
                    <span className="rule-row__note">
                      {describeRetention(pattern.retention)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rules-card">
            <h3 className="rules-card__title">Add Custom RegExp & Live Test</h3>
            <form className="manual-add-form" onSubmit={handleAddCustomRule}>
              <label htmlFor="custom-rule-name" className="rule-row__note">
                Rule name
              </label>
              <input
                id="custom-rule-name"
                type="text"
                className="ui-input"
                placeholder="e.g. Employee Badge ID"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
              />

              <label htmlFor="custom-rule-category" className="rule-row__note">
                Category
              </label>
              <select
                id="custom-rule-category"
                className="ui-select"
                value={ruleCategory}
                onChange={(e) => setRuleCategory(e.target.value as ExtendedCategory)}
              >
                {EXTENDED_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <label htmlFor="custom-rule-regex" className="rule-row__note">
                Regular expression (JavaScript, flags gu)
              </label>
              <input
                id="custom-rule-regex"
                type="text"
                className="ui-input"
                placeholder="e.g. EMP-\d{4}"
                value={ruleRegex}
                onChange={(e) => setRuleRegex(e.target.value)}
              />

              <label htmlFor="custom-rule-example" className="rule-row__note">
                Example value (optional)
              </label>
              <input
                id="custom-rule-example"
                type="text"
                className="ui-input"
                placeholder="e.g. EMP-9042"
                value={ruleExample}
                onChange={(e) => setRuleExample(e.target.value)}
              />

              {ruleError && (
                <div className="ui-alert" role="alert">
                  {ruleError}
                </div>
              )}

              <button type="submit" className="ui-btn ui-btn--primary">
                Add Custom Rule
              </button>
            </form>

            <div className="manual-add-form">
              <label htmlFor="rules-live-test" className="manual-add-form__title">
                Live Rule Tester ({liveTestHits.length} matched)
              </label>
              <textarea
                id="rules-live-test"
                rows={3}
                className="ui-textarea"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
              />
              <div className="suggestions-cats">
                {liveTestHits.map((hit) => (
                  <span key={hit.id} className={`pii-pill pii-pill--${hit.category}`}>
                    <span className="pii-pill__tag">{hit.category}</span>
                    <span>{hit.original}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="restore-grid">
          <div className="rules-card">
            <h3 className="rules-card__title">1. Load Sanitized Document & Mapping CSV</h3>
            <label htmlFor="restore-sanitized-file" className="rule-row__note">
              Sanitized document (.txt, .md, .csv, .docx, .xlsx, .pdf)
            </label>
            <input
              id="restore-sanitized-file"
              type="file"
              accept=".txt,.md,.markdown,.csv,.docx,.xlsx,.pdf"
              onChange={(e) => void handleSanitizedFileUpload(e.target.files?.[0] ?? null)}
            />

            <label htmlFor="restore-mapping-csv" className="rule-row__note">
              Mapping file (.mapping.csv)
            </label>
            <input
              id="restore-mapping-csv"
              type="file"
              accept=".csv"
              onChange={(e) => void handleMappingFileUpload(e.target.files?.[0] ?? null)}
            />

            {sessions.some((s) => s.mappings.length > 0) && (
              <button
                type="button"
                className="ui-btn ui-btn--sm"
                onClick={handleUseSessionMapping}
              >
                Use Current Session Mapping
              </button>
            )}

            <label htmlFor="restore-sanitized-text" className="rule-row__note">
              Or paste sanitized text containing [CATEGORY:hex6] markers
            </label>
            <textarea
              id="restore-sanitized-text"
              rows={5}
              className="ui-textarea"
              placeholder="Paste text with [EMAIL:a1b2c3] markers..."
              value={sanitizedInput}
              onChange={(e) => setSanitizedInput(e.target.value)}
            />

            {mappingStatus && (
              <div className="ui-alert ui-alert--ok" role="status">
                {mappingStatus}
              </div>
            )}
            {restoreError && (
              <div className="ui-alert" role="alert">
                {restoreError}
              </div>
            )}
          </div>

          <div className="rules-card">
            <h3 className="rules-card__title">2. Restored Output (Offline)</h3>
            {restoreOutcome ? (
              <>
                <div className="progress-card__meta">
                  Restored {restoreOutcome.restoredCount} marker(s)
                  {restoreOutcome.missingCodes.length > 0
                    ? ` · ${restoreOutcome.missingCodes.length} unmapped code(s): ${restoreOutcome.missingCodes.join(', ')}`
                    : ''}
                </div>
                <div className="restore-preview" aria-label="Restored document preview">
                  {restoreOutcome.restoredText}
                </div>
                <div className="rule-row__controls">
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary"
                    onClick={() => void handleDownloadRestored()}
                  >
                    Download Restored
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn--ghost"
                    onClick={() => {
                      const csv = serializeMapping(mappingEntries);
                      triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'mapping.csv');
                    }}
                  >
                    Download Mapping CSV
                  </button>
                </div>
              </>
            ) : (
              <p className="rule-row__note">
                Upload or paste a sanitized document together with its <code>.mapping.csv</code>{' '}
                to recover original entities locally in your browser.
              </p>
            )}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="batch-export-bar" aria-label="Batch multi-file export">
          <div>
            <strong>
              Batch Session ({sessions.length}/{MAX_BATCH_FILES} files)
            </strong>
            <div className="rule-row__note">
              {sessions.reduce((acc, s) => acc + s.stats.total, 0)} total PII entities across{' '}
              {sessions.map((s) => s.doc.fileName).join(', ')}
            </div>
            {batchStatus && (
              <div className="rule-row__note" role="status">
                {batchStatus}
              </div>
            )}
          </div>
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            disabled={batchBusy}
            onClick={() => void handleInternalBatchExport()}
          >
            {batchBusy ? 'Building ZIP…' : 'Export Batch ZIP'}
          </button>
        </div>
      )}
    </section>
  );
}
