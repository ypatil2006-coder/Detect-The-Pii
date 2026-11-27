import type { DocFormat, LoadedDocument, TextEdit } from '../core/types';
import { applyEditsToText, readBlobText } from './segments';

export async function parsePlainText(
  file: File,
  format: 'txt' | 'md' | 'csv',
): Promise<LoadedDocument> {
  const text = await readBlobText(file);
  return { fileName: file.name, format, text, handle: null };
}

export function generatePlainText(doc: LoadedDocument, edits: TextEdit[]): Blob {
  const text = applyEditsToText(doc.text, edits);
  const mime: Record<DocFormat, string> = {
    txt: 'text/plain;charset=utf-8',
    md: 'text/markdown;charset=utf-8',
    csv: 'text/csv;charset=utf-8',
    docx: '',
    xlsx: '',
    pdf: '',
  };
  return new Blob([text], { type: mime[doc.format] });
}
