import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY,
  getEffectivePatterns,
  loadConfig,
  newCustomId,
  removeCustom,
  saveConfig,
  setBuiltinEnabled,
  setCategoryRetention,
  upsertCustom,
  validateRegex,
} from '../../../src/core/pattern-store';
import type { CustomPatternConfig } from '../../../src/core/types';

const EXPECTED_BUILTIN_IDS = [
  'email',
  'in-pan',
  'in-aadhaar',
  'intl-phone',
  'credit-card',
  'ipv4',
  'ipv6',
];

function createMemoryStorage(): Storage {
  const store: Record<string, string> = {};
  const methods: Record<string, unknown> = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(store, name, { value: fn, enumerable: false });
  }
  Object.defineProperty(store, 'length', {
    get: () => Object.keys(store).length,
    enumerable: false,
  });
  return store as unknown as Storage;
}

let memStorage: Storage;

beforeEach(() => {
  memStorage = createMemoryStorage();
  vi.stubGlobal('localStorage', memStorage);
  Object.defineProperty(window, 'localStorage', {
    value: memStorage,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pattern-store', () => {
  it('loads default config on empty, corrupt JSON, or mismatched version', () => {
    expect(loadConfig()).toEqual({
      version: 1,
      disabledBuiltins: [],
      customPatterns: [],
    });

    memStorage.setItem(STORAGE_KEY, '{bad json');
    expect(loadConfig()).toEqual({
      version: 1,
      disabledBuiltins: [],
      customPatterns: [],
    });

    memStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, disabledBuiltins: ['email'], customPatterns: [] }),
    );
    expect(loadConfig()).toEqual({
      version: 1,
      disabledBuiltins: [],
      customPatterns: [],
    });
  });

  it('filters out invalid custom regexes on load and exposes built-ins via getEffectivePatterns', () => {
    const good: CustomPatternConfig = {
      id: 'c-good',
      name: 'Employee ID',
      category: 'CUSTOM',
      regex: 'EMP\\d{4}',
      example: 'EMP1234',
      enabled: true,
    };
    const bad: CustomPatternConfig = {
      id: 'c-bad',
      name: 'Broken',
      category: 'CUSTOM',
      regex: '(',
      example: 'x',
      enabled: true,
    };
    memStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, disabledBuiltins: [], customPatterns: [good, bad] }),
    );

    const cfg = loadConfig();
    expect(cfg.customPatterns).toHaveLength(1);
    expect(cfg.customPatterns[0].id).toBe('c-good');

    const effective = getEffectivePatterns(cfg);
    for (const id of EXPECTED_BUILTIN_IDS) {
      const p = effective.find((x) => x.id === id);
      expect(p).toBeDefined();
      expect(p?.source).toBe('builtin');
    }
  });

  it('supports toggling built-ins, upserting/removing custom rules, and category retention', () => {
    let config = loadConfig();
    config = setBuiltinEnabled(config, 'email', false);
    saveConfig(config);
    expect(getEffectivePatterns(loadConfig()).find((p) => p.id === 'email')?.enabled).toBe(
      false,
    );

    const custom: CustomPatternConfig = {
      id: newCustomId(),
      name: 'Ticket Code',
      category: 'CUSTOM',
      regex: 'TKT-\\d{4}',
      example: 'TKT-1024',
      enabled: true,
    };
    config = upsertCustom(config, custom);
    config = upsertCustom(config, { ...custom, name: 'Ticket v2' });
    expect(config.customPatterns).toHaveLength(1);
    expect(config.customPatterns[0].name).toBe('Ticket v2');

    config = setCategoryRetention(config, 'PAN', { mode: 'ends', head: 2, tail: 0 });
    expect(getEffectivePatterns(config).find((p) => p.category === 'PAN')?.retention).toEqual({
      mode: 'ends',
      head: 2,
      tail: 0,
    });
    config = setCategoryRetention(config, 'PAN', { mode: 'none' });
    expect(config.retention).toEqual({});

    config = removeCustom(config, custom.id);
    expect(config.customPatterns).toHaveLength(0);
  });

  it('validates regex syntax and rejects empty or empty-string-matching patterns', () => {
    expect(validateRegex('\\d{3}')).toBeNull();
    expect(validateRegex('(')).not.toBeNull();
    expect(validateRegex('')).not.toBeNull();
    expect(validateRegex('a*')).not.toBeNull();
    expect(() =>
      upsertCustom(loadConfig(), {
        id: 'c-1',
        name: 'Bad',
        category: 'CUSTOM',
        regex: '(',
        example: 'x',
        enabled: true,
      }),
    ).toThrow();
  });

  it('writes strictly rules-only config to localStorage (no PII)', () => {
    let config = setBuiltinEnabled(loadConfig(), 'email', false);
    config = upsertCustom(config, {
      id: 'c-priv',
      name: 'Priv',
      category: 'CUSTOM',
      regex: 'PRIV-\\d+',
      example: 'PRIV-1',
      enabled: true,
    });
    saveConfig(config);

    expect(Object.keys(memStorage)).toEqual([STORAGE_KEY]);
    const parsed = JSON.parse(memStorage.getItem(STORAGE_KEY)!) as Record<string, unknown>;
    expect(new Set(Object.keys(parsed))).toEqual(
      new Set(['version', 'disabledBuiltins', 'customPatterns']),
    );
  });
});
