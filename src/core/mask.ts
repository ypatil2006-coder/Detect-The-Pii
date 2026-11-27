import { formatPartialMask } from './redactor';
import type { Category } from './types';

function keepEnds(s: string, head: number, tail: number, fill = '*'): string {
  if (s.length <= head + tail) {
    return fill.repeat(Math.max(1, s.length));
  }
  return s.slice(0, head) + fill.repeat(s.length - head - tail) + s.slice(s.length - tail);
}

/**
 * Formats a human-readable partial mask for on-screen display across all
 * supported categories, guaranteeing the masked text differs from `original`.
 */
export function maskDisplay(category: Category, original: string): string {
  switch (category) {
    case 'EMAIL':
    case 'PHONE':
    case 'IP':
    case 'PAN':
    case 'AADHAAR':
    case 'CREDIT_CARD': {
      const masked = formatPartialMask(category, original);
      return masked === original ? keepEnds(original, 1, 0) : masked;
    }
    case 'SSN': {
      const digits = original.replace(/\D/g, '');
      return digits.length === 9 ? `***-**-${digits.slice(-4)}` : keepEnds(original, 0, 4);
    }
    case 'IBAN': {
      const compact = original.replace(/\s+/g, '');
      return keepEnds(compact, 2, 2);
    }
    case 'DOB': {
      if (/^\d{4}[-/.]/.test(original)) {
        return `${original.slice(0, 4)}-**-**`;
      }
      const year = original.match(/\d{4}$/)?.[0];
      return year ? `**-**-${year}` : keepEnds(original, 0, 4);
    }
    case 'CUSTOM':
    default:
      return keepEnds(original, 3, 0);
  }
}
