import JSZip from 'jszip';
import {
  MAX_FILE_BYTES,
  type LoadedDocument,
  type MappingEntry,
  type MarkerStyle,
  type RedactionItem,
  type TextEdit,
} from '../core/types';
import { serializeMapping } from './csv';
import { generateDocument, mappingFileName, outputFileName } from './index';

export const MAX_BATCH_FILES = 10;
export const MERGED_MAPPING_NAME = 'merged.mapping.csv';

export interface BatchEntry {
  doc: LoadedDocument;
  items: RedactionItem[];
}

export interface BatchManifestRow {
  source: string;
  output: string;
  mapping: string;
  count: number;
  partial?: boolean;
}

export type RedactDocumentFn = (
  text: string,
  items: RedactionItem[],
  style: MarkerStyle,
) => { edits: TextEdit[]; mapping: MappingEntry[] };

export function validateBatchFiles(
  files: { name: string; size: number }[],
): { ok: true } | { ok: false; error: string } {
  if (files.length === 0) {
    return { ok: false, error: 'Select at least one file to process.' };
  }
  if (files.length > MAX_BATCH_FILES) {
    return { ok: false, error: `Batch upload is limited to ${MAX_BATCH_FILES} files at once.` };
  }
  const oversized = files.filter((f) => f.size > MAX_FILE_BYTES);
  if (oversized.length > 0) {
    return {
      ok: false,
      error: `Files exceed the ${MAX_FILE_BYTES / 1024 / 1024} MB limit: ${oversized.map((f) => f.name).join(', ')}`,
    };
  }
  return { ok: true };
}

export function uniqueNamer(): (name: string) => string {
  const taken = new Set<string>();
  return (name) => {
    let candidate = name;
    let i = 2;
    while (taken.has(candidate)) {
      const dot = name.lastIndexOf('.');
      candidate =
        dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
      i += 1;
    }
    taken.add(candidate);
    return candidate;
  };
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function manifestCsv(rows: BatchManifestRow[], withMapping = true): string {
  const partial = rows.some((r) => r.partial);
  const headers = [
    'source',
    'output',
    ...(withMapping ? ['mapping'] : []),
    'redacted_count',
    ...(partial ? ['partial_retention'] : []),
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const fields = [
      row.source,
      row.output,
      ...(withMapping ? [row.mapping] : []),
      String(row.count),
      ...(partial ? [row.partial ? 'yes' : 'no'] : []),
    ];
    lines.push(fields.map(quoteCsv).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function isItemPartial(item: RedactionItem): boolean {
  if (item.retention) {
    return item.retention.mode !== 'none';
  }
  return Boolean(item.head || item.tail);
}

/**
 * Bundles multiple sanitized documents, optional reversible `.mapping.csv` tables,
 * and `manifest.csv` into a single client-side ZIP archive.
 */
export async function buildArchive(
  entries: BatchEntry[],
  redactFn: RedactDocumentFn,
  opts: { merged?: MappingEntry[]; style?: MarkerStyle } = {},
): Promise<{ blob: Blob; manifest: BatchManifestRow[] }> {
  const style = opts.style ?? 'pseudonym';
  const zip = new JSZip();
  const unique = uniqueNamer();
  const manifest: BatchManifestRow[] = [];
  const restorable = style === 'pseudonym' || (style as string) === 'code';

  for (const { doc, items } of entries) {
    const { edits, mapping } = redactFn(doc.text, items, style);
    const output = unique(outputFileName(doc.fileName, 'sanitized'));
    const mappingName = restorable ? unique(mappingFileName(doc.fileName)) : '';
    zip.file(output, await generateDocument(doc, edits));
    if (restorable) {
      zip.file(mappingName, serializeMapping(mapping));
    }
    const row: BatchManifestRow = {
      source: doc.fileName,
      output,
      mapping: mappingName,
      count: edits.length,
    };
    if (items.some((it) => it.active && isItemPartial(it))) {
      row.partial = true;
    }
    manifest.push(row);
  }

  if (opts.merged && restorable) {
    zip.file(unique(MERGED_MAPPING_NAME), serializeMapping(opts.merged));
  }
  zip.file('manifest.csv', manifestCsv(manifest, restorable));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, manifest };
}
