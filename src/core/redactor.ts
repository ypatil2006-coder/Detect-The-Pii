import { detectPii } from './detector';
import {
  createPseudonymState,
  type PiiMatch,
  type PiiType,
  type PseudonymMapEntry,
  type PseudonymState,
  type RedactionMode,
  type SanitizeResult,
} from './types';

const PSEUDONYM_PREFIX: Record<PiiType, string> = {
  EMAIL: 'USER',
  PHONE: 'PHONE',
  IP: 'IP',
  PAN: 'PAN',
  AADHAAR: 'AADHAAR',
  CREDIT_CARD: 'CARD',
};

/** Formats a verification-preserving partial mask for a validated PII value. */
export function formatPartialMask(type: PiiType, raw: string): string {
  const trimmed = raw.trim();
  switch (type) {
    case 'CREDIT_CARD': {
      const digits = trimmed.replace(/\D/g, '');
      return `XXXX-XXXX-XXXX-${digits.slice(-4)}`;
    }
    case 'AADHAAR': {
      const digits = trimmed.replace(/\D/g, '');
      return `XXXX-XXXX-${digits.slice(-4)}`;
    }
    case 'EMAIL': {
      const atIdx = trimmed.indexOf('@');
      if (atIdx <= 0) {
        return '[REDACTED]';
      }
      return `${trimmed[0]}***${trimmed.slice(atIdx)}`;
    }
    case 'PAN': {
      if (trimmed.length !== 10) {
        return '[REDACTED]';
      }
      return `${trimmed.slice(0, 2)}***${trimmed.slice(5)}`;
    }
    case 'IP': {
      if (trimmed.includes('.')) {
        const parts = trimmed.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.***.***`;
        }
      }
      if (trimmed.includes(':')) {
        const firstGroup = trimmed.split(':')[0] || '****';
        return `${firstGroup}:****:****`;
      }
      return '***.***.***.***';
    }
    case 'PHONE': {
      const digits = trimmed.replace(/\D/g, '');
      const last4 = digits.slice(-4);
      if (trimmed.startsWith('+91') || /^91[6-9]\d{9}$/.test(digits)) {
        return `+91-XXXXXX${last4}`;
      }
      if (trimmed.startsWith('+') && digits.length > 10) {
        const cc = digits.slice(0, digits.length - 10);
        return `+${cc}-XXXXXX${last4}`;
      }
      return `XXXXXX${last4}`;
    }
  }
}

function getOrAssignPseudonym(match: PiiMatch, state: PseudonymState): string {
  const key = `${match.type}:${match.normalized}`;
  const existing = state.map.get(key);
  if (existing) {
    return existing;
  }

  state.counters[match.type] += 1;
  const placeholder = `${PSEUDONYM_PREFIX[match.type]}_${String(
    state.counters[match.type],
  ).padStart(2, '0')}`;
  state.map.set(key, placeholder);
  return placeholder;
}

/**
 * Detects PII in text, applies the selected redaction mode, and returns both
 * the full `SanitizeResult` and per-match replacement strings for diff building.
 */
export function sanitizeTextWithReplacements(
  text: string,
  mode: RedactionMode,
  sharedState?: PseudonymState,
): { result: SanitizeResult; replacements: string[] } {
  const start = performance.now();
  const { matches, stats } = detectPii(text);
  const state = sharedState ?? createPseudonymState();
  const summaryByPlaceholder = new Map<string, PseudonymMapEntry>();

  if (matches.length === 0) {
    return {
      result: {
        original: text,
        sanitized: text,
        mode,
        matches,
        stats,
        pseudonyms: [],
        durationMs: performance.now() - start,
      },
      replacements: [],
    };
  }

  let cursor = 0;
  let sanitized = '';
  const replacements: string[] = [];

  for (const match of matches) {
    sanitized += text.slice(cursor, match.start);

    let replacement: string;
    if (mode === 'full') {
      replacement = '[REDACTED]';
    } else if (mode === 'partial') {
      replacement = formatPartialMask(match.type, match.value);
    } else {
      replacement = getOrAssignPseudonym(match, state);
      const entry = summaryByPlaceholder.get(replacement);
      if (entry) {
        entry.count += 1;
      } else {
        summaryByPlaceholder.set(replacement, {
          placeholder: replacement,
          type: match.type,
          maskedPreview: formatPartialMask(match.type, match.value),
          count: 1,
        });
      }
    }

    replacements.push(replacement);
    sanitized += replacement;
    cursor = match.end;
  }
  sanitized += text.slice(cursor);

  return {
    result: {
      original: text,
      sanitized,
      mode,
      matches,
      stats,
      pseudonyms: Array.from(summaryByPlaceholder.values()),
      durationMs: performance.now() - start,
    },
    replacements,
  };
}

/** Detects PII in text and applies the selected redaction mode. */
export function sanitizeText(
  text: string,
  mode: RedactionMode,
  sharedState?: PseudonymState,
): SanitizeResult {
  return sanitizeTextWithReplacements(text, mode, sharedState).result;
}
