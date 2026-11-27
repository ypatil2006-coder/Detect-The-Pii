import { describe, expect, it } from 'vitest';
import { detectPii } from '../../src/core/detector';
import { runPipeline } from '../../src/core/pipeline';
import { runPipelineAsync } from '../../src/core/worker';
import type { RedactionMode } from '../../src/core/types';
import { getSampleById, SAMPLE_PRESETS } from '../../src/formats/samples';

const MODES: RedactionMode[] = ['full', 'partial', 'pseudonym'];

describe('runPipeline integration', () => {
  it.each(
    SAMPLE_PRESETS.flatMap((preset) => MODES.map((mode) => ({ preset, mode }))),
  )('sanitizes $preset.id in $mode mode with zero raw PII remaining', ({ preset, mode }) => {
    const originalMatches = detectPii(preset.content).matches;
    const output = runPipeline(preset.content, preset.kind, mode);

    expect(output.stats.total).toBeGreaterThanOrEqual(6);
    expect(output.stats.rejectedCreditCards).toBeGreaterThanOrEqual(1);

    for (const match of originalMatches) {
      expect(output.sanitized).not.toContain(match.value);
    }

    if (mode === 'full' || mode === 'pseudonym') {
      const residual = detectPii(output.sanitized).matches;
      expect(residual).toEqual([]);
    }

    const inputLines = preset.content.split('\n');
    const sanitizedLines = output.sanitized.split('\n');
    expect(output.diffRows).toHaveLength(inputLines.length);
    expect(output.diffRows.map((r) => r.originalSegments.map((s) => s.text).join(''))).toEqual(
      inputLines,
    );
    expect(output.diffRows.map((r) => r.sanitizedSegments.map((s) => s.text).join(''))).toEqual(
      sanitizedLines,
    );
  });

  it('preserves deliberate non-Luhn 16-digit order/reference numbers in all samples', () => {
    const supportOut = runPipeline(getSampleById('support-log').content, 'txt', 'full');
    expect(supportOut.sanitized).toContain('1234-5678-9012-3456');
    expect(supportOut.stats.rejectedCreditCards).toBe(1);

    const clinicalOut = runPipeline(getSampleById('clinical-resume').content, 'txt', 'full');
    expect(clinicalOut.sanitized).toContain('9988776655443322');
    expect(clinicalOut.stats.rejectedCreditCards).toBe(1);

    const csvOut = runPipeline(getSampleById('customers-csv').content, 'csv', 'full');
    expect(csvOut.sanitized).toContain('1234567890123456');
    expect(csvOut.stats.rejectedCreditCards).toBe(1);
  });

  it('maintains consistent USER_01 pseudonymization across txt lines and csv rows', () => {
    const txtOut = runPipeline(getSampleById('support-log').content, 'txt', 'pseudonym');
    const txtLines = txtOut.sanitized.split('\n');
    expect(txtLines[0]).toContain('USER_01');
    expect(txtLines[5]).toContain('USER_01');
    expect(txtLines[5]).toContain('USER_02');

    const csvOut = runPipeline(getSampleById('customers-csv').content, 'csv', 'pseudonym');
    const csvLines = csvOut.sanitized.split('\n');
    expect(csvLines[1]).toContain('USER_01');
    expect(csvLines[2]).toContain('USER_02');
    expect(csvLines[3]).toContain('USER_01');
    // Quoted comma field remains valid RFC-4180 CSV
    expect(csvLines[1].startsWith('"Sharma, Rahul",USER_01,')).toBe(true);
  });

  it('handles XSS payloads safely as plain text and stays sub-50ms on 50KB noise', async () => {
    const xssPayload = '<script>alert(1)</script> <img src=x onerror=alert(1)> rahul@acme.com';
    const xssOut = await runPipelineAsync(xssPayload, 'txt', 'pseudonym');
    expect(xssOut.sanitized).toBe('<script>alert(1)</script> <img src=x onerror=alert(1)> USER_01');

    const chunk = '1234-5678-9012-3456 999.168.1.1 v1.2.3.4 :: 12:34:56\n';
    const largeNoise = chunk.repeat(Math.ceil(50_000 / chunk.length)).slice(0, 50_000);
    const largeOut = runPipeline(largeNoise, 'txt', 'full');
    expect(largeOut.stats.total).toBe(0);
    expect(largeOut.durationMs).toBeLessThan(50);
  });
});
