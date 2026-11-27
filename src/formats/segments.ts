import type { TextEdit } from '../core/types';

/** Contiguous run of document text owned by one structural node (e.g., DOCX `<w:t>` or PDF item). */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

interface LocalOp {
  start: number;
  end: number;
  replacement: string;
}

/** Reads raw bytes from a File/Blob, falling back to FileReader in jsdom environments. */
export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read binary file.'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Reads UTF-8 text from a File/Blob, falling back to FileReader in jsdom environments. */
export async function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read text file.'));
    reader.readAsText(blob);
  });
}

/** Applies offset-based text edits to a raw string without mutating the original. */
export function applyEditsToText(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}

/**
 * Distributes full-text edits across structural segments. An edit spanning multiple
 * segments places its replacement in the first touched segment and clears the rest.
 */
export function distributeEdits(segments: Segment[], edits: TextEdit[]): Map<number, string> {
  const ops = new Map<number, LocalOp[]>();
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let segIdx = 0;

  for (const edit of sorted) {
    while (segIdx < segments.length && segments[segIdx].end <= edit.start) {
      segIdx += 1;
    }
    let first = true;
    for (let i = segIdx; i < segments.length && segments[i].start < edit.end; i += 1) {
      const seg = segments[i];
      const localStart = Math.max(edit.start, seg.start) - seg.start;
      const localEnd = Math.min(edit.end, seg.end) - seg.start;
      if (localEnd < localStart) continue;
      if (!ops.has(i)) ops.set(i, []);
      ops.get(i)!.push({
        start: localStart,
        end: localEnd,
        replacement: first ? edit.replacement : '',
      });
      first = false;
    }
    if (first) {
      throw new Error(`Edit range [${edit.start}, ${edit.end}) does not map to any text node.`);
    }
  }

  const out = new Map<number, string>();
  for (const [i, list] of ops) {
    let text = segments[i].text;
    for (const op of list.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, op.start) + op.replacement + text.slice(op.end);
    }
    out.set(i, text);
  }
  return out;
}
