import type { PseudonymState, RedactionMode, SanitizeFn, SanitizeResult } from '../core/types';

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type FileValidationResult =
  | { ok: true; kind: 'txt' | 'csv' }
  | { ok: false; error: string };

/**
 * Validates that an uploaded file has a supported `.txt` or `.csv` extension,
 * is non-empty, and stays within the client-side size limit.
 */
export function validateUploadFile(
  file: { name: string; size: number },
  maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
): FileValidationResult {
  const trimmedName = file.name.trim();
  if (!trimmedName) {
    return { ok: false, error: 'File name is missing.' };
  }

  const lower = trimmedName.toLowerCase();
  let kind: 'txt' | 'csv' | null = null;
  if (lower.endsWith('.txt')) {
    kind = 'txt';
  } else if (lower.endsWith('.csv')) {
    kind = 'csv';
  }

  if (!kind) {
    return {
      ok: false,
      error: 'Unsupported file type. Only .txt and .csv files are accepted.',
    };
  }

  if (file.size <= 0) {
    return { ok: false, error: 'Uploaded file is empty.' };
  }

  if (file.size > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `File exceeds the ${maxMb} MB client-side processing limit.`,
    };
  }

  return { ok: true, kind };
}

/**
 * Builds a deterministic client-side download filename preserving the base name
 * and appending the active redaction mode.
 */
export function buildDownloadFilename(
  originalName: string | null,
  kind: 'txt' | 'csv',
  mode: RedactionMode,
): string {
  const fallbackBase = 'sanitized-output';
  if (!originalName || !originalName.trim()) {
    return `${fallbackBase}.sanitized-${mode}.${kind}`;
  }

  const leaf = originalName.trim().split(/[\\/]/).pop() ?? '';
  const stripped = leaf.replace(/\.(txt|csv)$/i, '').replace(/[^\w.-]+/g, '_');
  const base = stripped || fallbackBase;
  return `${base}.sanitized-${mode}.${kind}`;
}

/** Strips a leading UTF-8 BOM and normalizes CRLF/CR line endings to LF. */
export function normalizeTxtContent(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/** Normalizes plain text input and delegates sanitization to the injected engine. */
export function sanitizeTxt(
  text: string,
  mode: RedactionMode,
  sanitizeFn: SanitizeFn,
  sharedState?: PseudonymState,
): SanitizeResult {
  return sanitizeFn(normalizeTxtContent(text), mode, sharedState);
}
