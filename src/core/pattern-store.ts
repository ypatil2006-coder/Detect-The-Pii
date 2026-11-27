import type {
  Category,
  CustomPatternConfig,
  Pattern,
  PatternConfig,
  Retention,
} from './types';
import { BUILTIN_PATTERNS } from './patterns';
import { sanitizeRetention } from './retention';

export const STORAGE_KEY = 'deid.patternConfig.v1';

function defaultConfig(): PatternConfig {
  return { version: 1, disabledBuiltins: [], customPatterns: [] };
}

function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readRetention(x: unknown): Record<string, Retention> {
  const out: Record<string, Retention> = {};
  if (!x || typeof x !== 'object') {
    return out;
  }
  for (const [id, r] of Object.entries(x)) {
    const ok = sanitizeRetention(r);
    if (ok && ok.mode !== 'none') {
      out[id] = ok;
    }
  }
  return out;
}

/** Loads persisted pattern toggles, custom rules, and retention settings from `localStorage`. */
export function loadConfig(): PatternConfig {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultConfig();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PatternConfig>;
    if (parsed.version !== 1) {
      return defaultConfig();
    }
    const config: PatternConfig = {
      version: 1,
      disabledBuiltins: Array.isArray(parsed.disabledBuiltins)
        ? parsed.disabledBuiltins.filter((x) => typeof x === 'string')
        : [],
      customPatterns: Array.isArray(parsed.customPatterns)
        ? parsed.customPatterns.filter(
            (c) => c && typeof c.regex === 'string' && validateRegex(c.regex) === null,
          )
        : [],
    };
    const retention = readRetention(parsed.retention);
    if (Object.keys(retention).length > 0) {
      config.retention = retention;
    }
    return config;
  } catch {
    return defaultConfig();
  }
}

/** Saves pattern configuration (rules only, never document PII) to `localStorage`. */
export function saveConfig(config: PatternConfig): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** Returns an error string, or `null` if the pattern compiles cleanly with `'gu'` flags. */
export function validateRegex(src: string): string | null {
  if (!src.trim()) {
    return 'Pattern regex cannot be empty.';
  }
  try {
    const re = new RegExp(src, 'gu');
    if (re.test('')) {
      return 'Pattern regex cannot match empty strings.';
    }
    return null;
  } catch (e) {
    return `Invalid regular expression: ${(e as Error).message}`;
  }
}

/** Merges built-in rules with persisted enabled toggles, custom rules, and retention settings. */
export function getEffectivePatterns(config: PatternConfig = loadConfig()): Pattern[] {
  const disabled = new Set(config.disabledBuiltins);
  const retention = config.retention ?? {};
  const builtins: Pattern[] = BUILTIN_PATTERNS.map((p) => ({
    ...p,
    enabled: !disabled.has(p.id),
    retention: retention[p.id],
  }));
  const customs: Pattern[] = config.customPatterns.map((c) => ({
    ...c,
    source: 'custom',
    retention: retention[c.id],
  }));
  return [...builtins, ...customs];
}

export function setBuiltinEnabled(
  config: PatternConfig,
  id: string,
  enabled: boolean,
): PatternConfig {
  const set = new Set(config.disabledBuiltins);
  if (enabled) {
    set.delete(id);
  } else {
    set.add(id);
  }
  return { ...config, disabledBuiltins: [...set] };
}

export function upsertCustom(
  config: PatternConfig,
  custom: CustomPatternConfig,
): PatternConfig {
  const err = validateRegex(custom.regex);
  if (err) {
    throw new Error(err);
  }
  const idx = config.customPatterns.findIndex((c) => c.id === custom.id);
  const list = [...config.customPatterns];
  if (idx >= 0) {
    list[idx] = custom;
  } else {
    list.push(custom);
  }
  return { ...config, customPatterns: list };
}

export function removeCustom(config: PatternConfig, id: string): PatternConfig {
  const retention = { ...(config.retention ?? {}) };
  delete retention[id];
  return {
    ...config,
    customPatterns: config.customPatterns.filter((c) => c.id !== id),
    retention,
  };
}

export function setRetention(
  config: PatternConfig,
  id: string,
  r: Retention,
): PatternConfig {
  const retention = { ...(config.retention ?? {}) };
  if (r.mode === 'none') {
    delete retention[id];
  } else {
    retention[id] = r;
  }
  return { ...config, retention };
}

/** Applies a single retention rule to every built-in and custom pattern in `category`. */
export function setCategoryRetention(
  config: PatternConfig,
  category: Category,
  r: Retention,
): PatternConfig {
  let next = config;
  for (const p of getEffectivePatterns(config)) {
    if (p.category === category) {
      next = setRetention(next, p.id, r);
    }
  }
  return next;
}

/** Generates a random `c-xxxxxx` custom pattern identifier. */
export function newCustomId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return 'c-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
