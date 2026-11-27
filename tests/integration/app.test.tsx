import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/ui/App';
import { PipelineFlow } from '../../src/ui/PipelineFlow';
import type { PipelineStageTiming } from '../../src/core/pipeline';

const SAMPLE_STAGES: PipelineStageTiming[] = [
  { id: 'parse', label: 'Input Parse', durationMs: 0.1, matchedCount: 6 },
  { id: 'scan', label: 'Pattern Scan', durationMs: 0.4, matchedCount: 9 },
  { id: 'luhn', label: 'Luhn Card Check', durationMs: 0.2, matchedCount: 1, rejectedCount: 1 },
  { id: 'verhoeff', label: 'Verhoeff Aadhaar Check', durationMs: 0.2, matchedCount: 1, rejectedCount: 0 },
  { id: 'validators', label: 'PAN / IP / Email / Phone', durationMs: 0.3, matchedCount: 7 },
  { id: 'redact', label: 'Mode Operator', durationMs: 0.1, matchedCount: 9 },
  { id: 'diff', label: 'Diff & Export', durationMs: 0.1, matchedCount: 6 },
];

describe('PII Sanitizer Workbench UI Integration', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    const memoryStorage: Storage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    };
    Object.defineProperty(window, 'localStorage', {
      writable: true,
      configurable: true,
      value: memoryStorage,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders semantic landmarks, accessible controls, and loads 1-click sample into Checklist + Diff + Audit', async () => {
    render(<App />);

    expect(screen.getByRole('navigation', { name: /workspace navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /audit dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting input/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /client-side pii sanitizer/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    const moreFormatsBtn = screen.getByRole('button', { name: /more formats/i });
    fireEvent.click(moreFormatsBtn);
    expect(screen.getByRole('menuitem', { name: /sample pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sample word/i })).toBeInTheDocument();
    fireEvent.click(moreFormatsBtn);

    fireEvent.click(screen.getByRole('button', { name: /support log/i }));

    const checklist = await screen.findByRole('region', { name: /sanitization progress checklist/i });
    expect(within(checklist).getByText(/7 steps · Completed/i)).toBeInTheDocument();

    const diffView = screen.getByRole('region', { name: /side-by-side diff/i });
    expect(within(diffView).getByLabelText(/^Original input$/i)).toBeInTheDocument();
    expect(within(diffView).getByLabelText(/^Sanitized output$/i)).toBeInTheDocument();
    expect(within(diffView).getAllByText('USER_01').length).toBeGreaterThanOrEqual(1);

    const audit = screen.getByRole('complementary', { name: /audit dashboard/i });
    expect(within(audit).getByText(/Failed Luhn mod-10/i)).toBeInTheDocument();
  });

  it('switches across all 5 redaction modes and supports Changed lines only toggle', async () => {
    render(<App />);

    const textarea = screen.getByLabelText(/paste text to sanitize/i);
    fireEvent.change(textarea, {
      target: {
        value: 'Line 1 clean text\nLine 2 contact rahul@acme.example\nLine 3 clean tail',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /sanitize text/i }));

    const diffRegion = await screen.findByRole('region', { name: /side-by-side diff/i });
    const sanitizedPane = within(diffRegion).getByLabelText(/sanitized output/i);

    expect(within(sanitizedPane).getByText('USER_01')).toBeInTheDocument();

    fireEvent.click(within(diffRegion).getByRole('radio', { name: /full mask/i }));
    expect(within(sanitizedPane).getByText('[REDACTED]')).toBeInTheDocument();

    fireEvent.click(within(diffRegion).getByRole('radio', { name: /partial mask/i }));
    expect(within(sanitizedPane).getByText('r***@acme.example')).toBeInTheDocument();

    fireEvent.click(within(diffRegion).getByRole('radio', { name: /category tag/i }));
    expect(within(sanitizedPane).getByText('[EMAIL]')).toBeInTheDocument();

    fireEvent.click(within(diffRegion).getByRole('radio', { name: /blank placeholder/i }));
    expect(within(sanitizedPane).getByText('○○○○○@○○○○.○○○○○○○')).toBeInTheDocument();

    const changedToggle = within(diffRegion).getByLabelText(/changed lines only/i);
    fireEvent.click(changedToggle);
    expect(within(sanitizedPane).queryByText(/Line 1 clean text/i)).not.toBeInTheDocument();
    expect(within(diffRegion).getByText('1 / 3 lines')).toBeInTheDocument();
  });

  it('supports interactive suggestion toggles, category mute, manual redaction, overlap guard, and reset', async () => {
    render(<App />);

    const textarea = screen.getByLabelText(/paste text to sanitize/i);
    fireEvent.change(textarea, {
      target: {
        value: 'Ticket ALPHA-77 opened by rahul@acme.example for Project Falcon',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /sanitize text/i }));

    const suggestions = await screen.findByRole('complementary', { name: /suggestions and manual review/i });
    const emailCheckbox = within(suggestions).getByRole('checkbox', {
      name: /toggle redaction for email/i,
    });
    expect(emailCheckbox).toBeChecked();

    fireEvent.click(emailCheckbox);
    expect(emailCheckbox).not.toBeChecked();

    const categoryBtn = within(suggestions).getByRole('button', { name: /EMAIL\s*0\/1/i });
    fireEvent.click(categoryBtn);
    expect(emailCheckbox).toBeChecked();

    // Add manual redaction
    const manualInput = within(suggestions).getByLabelText(/highlight text in original input/i);
    fireEvent.change(manualInput, { target: { value: 'Project Falcon' } });
    fireEvent.click(within(suggestions).getByRole('button', { name: /^Add$/i }));

    const sanitizedPane = screen.getByLabelText(/sanitized output/i);
    expect(within(sanitizedPane).getByText('CUSTOM_01')).toBeInTheDocument();

    // Overlapping manual selection should show alert without crashing
    fireEvent.change(manualInput, { target: { value: 'rahul@acme.example' } });
    fireEvent.click(within(suggestions).getByRole('button', { name: /^Add$/i }));
    expect(within(suggestions).getByRole('alert')).toHaveTextContent(/overlaps/i);

    fireEvent.click(within(suggestions).getByRole('button', { name: /reset overrides/i }));
    expect(within(sanitizedPane).queryByText('CUSTOM_01')).not.toBeInTheDocument();
  });

  it('prevents XSS injection in pasted text and handles Unicode/RTL safely', async () => {
    render(<App />);

    const xssPayload = '<script>window.__xss=true</script><img src=x onerror="alert(1)"> مرحبا 🛡️ rahul@acme.example';
    const textarea = screen.getByLabelText(/paste text to sanitize/i);
    fireEvent.change(textarea, { target: { value: xssPayload } });
    fireEvent.click(screen.getByRole('button', { name: /sanitize text/i }));

    const diffRegion = await screen.findByRole('region', { name: /side-by-side diff/i });
    const origPane = within(diffRegion).getByText('Original Input').closest('.diff-pane') as HTMLElement;

    expect(origPane.querySelector('script')).toBeNull();
    expect(origPane.querySelector('img')).toBeNull();
    expect(within(origPane).getByText(/<script>window\.__xss=true<\/script>/i)).toBeInTheDocument();
    expect(within(origPane).getByText(/مرحبا/i)).toBeInTheDocument();
  });

  it('drives PipelineFlow step/replay/scrubber controls and respects prefers-reduced-motion', () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
      render(<PipelineFlow stages={SAMPLE_STAGES} totalMs={1.4} isRunning={false} runId={1} />);

      const flow = screen.getByRole('region', { name: /sanitization pipeline workflow/i });
      expect(within(flow).getByText('Input Parse')).toBeInTheDocument();
      expect(within(flow).getByText('Luhn Card Check')).toBeInTheDocument();
      expect(within(flow).getByText('Verhoeff Aadhaar Check')).toBeInTheDocument();
      expect(within(flow).getByText(/1 REJECTED/i)).toBeInTheDocument();
      expect(within(flow).getByText(/Phase 5\/5 · 100%/i)).toBeInTheDocument();

      const scrubber = within(flow).getByRole('slider', { name: /timeline scrubber/i });
      fireEvent.change(scrubber, { target: { value: '0' } });
      expect(within(flow).getByText(/Phase 1\/5 · 0%/i)).toBeInTheDocument();

      fireEvent.click(within(flow).getByRole('button', { name: /step/i }));
      expect(within(flow).getByText(/Phase 2\/5/i)).toBeInTheDocument();

      fireEvent.click(within(flow).getByRole('button', { name: /replay/i }));
      expect(within(flow).getByText(/Phase 5\/5 · 100%/i)).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('supports custom RegExp rules, offline CSV restore upload, and client-side Blob downloads', async () => {
    const createObjectUrlSpy = vi.fn(() => 'blob:mock-url');
    const revokeObjectUrlSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { writable: true, value: createObjectUrlSpy });
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: revokeObjectUrlSpy });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<App />);

    // 1. Custom rule validation & live test
    fireEvent.click(screen.getByRole('button', { name: /rules & patterns/i }));
    const rulesPanel = await screen.findByRole('region', {
      name: /detection rules and document restore/i,
    });

    fireEvent.change(within(rulesPanel).getByLabelText(/rule name/i), {
      target: { value: 'Badge ID' },
    });
    fireEvent.change(within(rulesPanel).getByLabelText(/regular expression/i), {
      target: { value: '[invalid(' },
    });
    fireEvent.click(within(rulesPanel).getByRole('button', { name: /add custom rule/i }));
    expect(within(rulesPanel).getByRole('alert')).toHaveTextContent(/invalid regular expression/i);

    fireEvent.change(within(rulesPanel).getByLabelText(/regular expression/i), {
      target: { value: 'EMP-\\d{4}' },
    });
    fireEvent.click(within(rulesPanel).getByRole('button', { name: /add custom rule/i }));
    expect(within(rulesPanel).getByText('Badge ID')).toBeInTheDocument();

    // 2. Document Restore via sanitized .txt + .mapping.csv upload
    fireEvent.click(within(rulesPanel).getByRole('tab', { name: /document restore/i }));

    const sanitizedFile = new File(['Contact [EMAIL:a1b2c3] immediately'], 'note.sanitized.txt', {
      type: 'text/plain',
    });
    const mappingFile = new File(
      ['\uFEFFcode,category,original\r\na1b2c3,EMAIL,rahul@acme.example\r\n'],
      'note.mapping.csv',
      { type: 'text/csv' },
    );

    fireEvent.change(within(rulesPanel).getByLabelText(/sanitized document/i), {
      target: { files: [sanitizedFile] },
    });
    fireEvent.change(within(rulesPanel).getByLabelText(/mapping file/i), {
      target: { files: [mappingFile] },
    });

    await waitFor(() => {
      expect(within(rulesPanel).getByLabelText(/restored document preview/i)).toHaveTextContent(
        'Contact rahul@acme.example immediately',
      );
    });

    fireEvent.click(within(rulesPanel).getByRole('button', { name: /download restored/i }));
    await waitFor(() => {
      expect(createObjectUrlSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    // 3. Sanitize session download (sanitized + mapping CSV)
    fireEvent.click(screen.getByRole('button', { name: /sanitize workbench/i }));
    fireEvent.click(screen.getByRole('button', { name: /support log/i }));

    const downloadSanitizedBtn = await screen.findByRole('button', { name: /download sanitized/i });
    const downloadMappingBtn = screen.getByRole('button', { name: /mapping csv/i });

    fireEvent.click(downloadSanitizedBtn);
    fireEvent.click(downloadMappingBtn);

    await waitFor(() => {
      expect(createObjectUrlSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });
});
