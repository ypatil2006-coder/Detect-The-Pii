import {
  analyzeDocument,
  type DocumentSessionResult,
} from './document-pipeline';
import { runPipeline, type PipelineOutput } from './pipeline';
import type {
  LoadedDocument,
  MappingEntry,
  MarkerStyle,
  Pattern,
  PseudonymState,
  RedactionMode,
} from './types';

/** Message payload sent to the sanitization Web Worker. */
export interface WorkerRequest {
  id: string;
  input: string;
  kind: 'txt' | 'csv';
  mode: RedactionMode;
}

/** Response payload emitted by the sanitization Web Worker. */
export type WorkerResponse =
  | { id: string; ok: true; result: PipelineOutput }
  | { id: string; ok: false; error: string };

const WORKER_THRESHOLD_CHARS = 100_000;

interface WorkerScopeLike {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void;
  postMessage: (message: WorkerResponse) => void;
}

if ('DedicatedWorkerGlobalScope' in globalThis && typeof self !== 'undefined') {
  const workerSelf = self as unknown as WorkerScopeLike;
  workerSelf.addEventListener('message', (event) => {
    const { id, input, kind, mode } = event.data;
    try {
      const result = runPipeline(input, kind, mode);
      workerSelf.postMessage({ id, ok: true, result });
    } catch (err) {
      workerSelf.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : 'Sanitization worker error',
      });
    }
  });
}

let requestCounter = 0;

/**
 * Executes `runPipeline`, offloading large payloads to a Web Worker when available
 * and falling back synchronously when `Worker` is unavailable (e.g. jsdom).
 */
export function runPipelineAsync(
  input: string,
  kind: 'txt' | 'csv',
  mode: RedactionMode,
): Promise<PipelineOutput> {
  if (input.length < WORKER_THRESHOLD_CHARS || typeof Worker === 'undefined') {
    return Promise.resolve(runPipeline(input, kind, mode));
  }

  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker;

    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      resolve(runPipeline(input, kind, mode));
      return;
    }

    const id = `req-${++requestCounter}`;
    const cleanup = () => {
      worker.terminate();
    };

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      if (settled || event.data.id !== id) {
        return;
      }
      settled = true;
      cleanup();
      if (event.data.ok) {
        resolve(event.data.result);
      } else {
        resolve(runPipeline(input, kind, mode));
      }
    });

    worker.addEventListener('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(runPipeline(input, kind, mode));
    });

    const request: WorkerRequest = { id, input, kind, mode };
    worker.postMessage(request);
  });
}

/**
 * Runs `analyzeDocument` asynchronously, avoiding `postMessage` serialization errors
 * on binary format handles (`JSZip`/`PdfHandle`) and `Pattern.validate` functions.
 */
export function analyzeDocumentAsync(
  doc: LoadedDocument,
  patterns: Pattern[],
  markerStyle: MarkerStyle,
  sharedState?: PseudonymState,
  existingMappings?: MappingEntry[],
): Promise<DocumentSessionResult> {
  return Promise.resolve().then(() =>
    analyzeDocument(doc, patterns, markerStyle, sharedState, existingMappings),
  );
}
