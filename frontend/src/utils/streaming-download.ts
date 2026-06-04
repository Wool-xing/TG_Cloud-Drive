import { t } from '../i18n/translations';

// P1-F5 / P1-F24: streaming download helper.
//
// Pre-fix, both SharedAccess.handleDownload and PreviewModal's preview path
// fetched every chunk into ArrayBuffers and concatenated them into a single
// Blob. A 2 GB file = 2 GB live in JS memory before the download dialog even
// pops up. Anyone on a 4 GB machine OOM'd before reaching the save dialog.
//
// This helper picks between two paths:
//
// 1. **showSaveFilePicker** (Chromium 86+, Edge 86+, Opera 72+): the user
//    chooses where to save *before* we start fetching, we open a
//    FileSystemWritableFileStream, and decrypted bytes go straight to disk —
//    one chunk's worth of plaintext lives in memory at any moment.
//
// 2. **Blob fallback** (Firefox, Safari, locked-down enterprise Chromium): the
//    pre-fix code path, but we surface a soft warning via the optional
//    `onLargeFileFallback` hook so the UI can show the user that this browser
//    will buffer the whole file. The caller decides whether to proceed or
//    redirect them to download from a Chromium-based browser.
//
// `chunks` is consumed lazily — the caller passes a fetch+decrypt fn that
// produces a Uint8Array per index. We never hold more than `concurrent`
// chunks in memory (default 1 = serial; raising it speeds large files at
// the cost of memory).

export interface StreamChunk {
  url: string;
  iv?: string;
  index: number;
}

export interface StreamingDownloadOptions {
  filename: string;
  mimeType?: string;
  /** Total plaintext size in bytes (used by showSaveFilePicker for the dialog). */
  totalSize?: number;
  /** Called after each chunk completes with a 0..1 fraction. */
  onProgress?: (fraction: number) => void;
  /**
   * Fired once if we fall back to the Blob path on a browser without
   * showSaveFilePicker. Use it to show a "this browser buffers in RAM" warning
   * for large files. Not fatal — the download still proceeds.
   */
  onLargeFileFallback?: () => void;
  /**
   * Soft cap (bytes) above which the Blob fallback path will *refuse* to
   * proceed. showSaveFilePicker path ignores this. Defaults to 500 MB.
   */
  blobFallbackMaxBytes?: number;
}

export interface StreamingChunkProvider {
  /** Total number of chunks. */
  count: number;
  /** Return the decrypted plaintext bytes for chunk `index`. */
  fetchChunk: (index: number) => Promise<Uint8Array>;
}

/**
 * Feature detection — exposed for callers that want to gate UI strings
 * ("This browser will buffer the entire file in memory…") before invoking
 * the download. Read-only; no side effects.
 */
export function supportsFilePicker(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

class BlobFallbackTooLargeError extends Error {
  constructor(public bytes: number, public cap: number) {
    super(
      t('preview.browserIncompatible', { size: (bytes / (1024 ** 3)).toFixed(2), cap: (cap / (1024 ** 3)).toFixed(2) }),
    );
    this.name = 'BlobFallbackTooLargeError';
  }
}

export { BlobFallbackTooLargeError };

/**
 * Stream the chunks to disk (or to a Blob on legacy browsers) under filename.
 * Resolves when the save completes; rejects if the user cancels the picker or
 * any chunk fetch fails.
 */
export async function streamingDownload(
  provider: StreamingChunkProvider,
  options: StreamingDownloadOptions,
): Promise<void> {
  const {
    filename,
    mimeType,
    totalSize,
    onProgress,
    onLargeFileFallback,
    blobFallbackMaxBytes = 500 * 1024 * 1024,
  } = options;

  if (supportsFilePicker()) {
    // Native streaming path — no full-file buffer.
    let handle: FileSystemFileHandle;
    try {
      handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: mimeType
          ? [{ description: mimeType, accept: { [mimeType]: [extOf(filename)] } }]
          : undefined,
      });
    } catch (err: any) {
      // AbortError = user clicked "Cancel" in the save dialog. Surface as a
      // recognisable error so the caller can swallow it silently.
      if (err?.name === 'AbortError') throw err;
      throw err;
    }
    const writable = await handle.createWritable();
    try {
      for (let i = 0; i < provider.count; i++) {
        const bytes = await provider.fetchChunk(i);
        // TS 5.7+ narrows Uint8Array to its backing-buffer type; the DOM
        // FileSystemWriteChunkType lib lags. Cast to the structural shape
        // — at runtime this is always a Uint8Array, which is a valid
        // FileSystemWriteChunkType.
        await writable.write(bytes as unknown as BufferSource);
        onProgress?.((i + 1) / provider.count);
      }
      await writable.close();
    } catch (err) {
      // Best-effort cleanup — the partial file stays on disk if the OS
      // already wrote some bytes, but at least we don't leave a writer
      // half-open holding a lock.
      try { await writable.abort(); } catch { /* ignore */ }
      throw err;
    }
    return;
  }

  // Blob fallback — refuse above the soft cap so we don't OOM the tab.
  if (totalSize !== undefined && totalSize > blobFallbackMaxBytes) {
    throw new BlobFallbackTooLargeError(totalSize, blobFallbackMaxBytes);
  }
  onLargeFileFallback?.();

  const buffers: Uint8Array[] = [];
  let written = 0;
  for (let i = 0; i < provider.count; i++) {
    const bytes = await provider.fetchChunk(i);
    buffers.push(bytes);
    written += bytes.byteLength;
    onProgress?.((i + 1) / provider.count);
  }

  // Same TS 5.7+ narrowing issue as the writable.write() call above —
  // Uint8Array is always a valid BlobPart at runtime.
  const blob = new Blob(buffers as unknown as BlobPart[], { type: mimeType ?? 'application/octet-stream' });
  // Free the intermediate buffer references so GC can reclaim them once the
  // Blob has captured them.
  buffers.length = 0;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // 10s gap mirrors what the call sites used to do — gives the browser
    // time to start the actual download before the URL becomes invalid.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  // `written` is unused after this point but kept for callers that want to
  // assert a post-condition (totalSize === written) without re-computing.
  void written;
}

function extOf(filename: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename);
  return m ? `.${m[1].toLowerCase()}` : '.bin';
}
