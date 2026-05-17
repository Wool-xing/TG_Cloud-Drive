import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supportsFilePicker, BlobFallbackTooLargeError, streamingDownload } from './streaming-download';

describe('supportsFilePicker', () => {
  it('returns false when showSaveFilePicker is absent', () => {
    expect(supportsFilePicker()).toBe(false);
  });

  it('returns true when stub is set', () => {
    const stub = vi.fn();
    (window as any).showSaveFilePicker = stub;
    expect(supportsFilePicker()).toBe(true);
    delete (window as any).showSaveFilePicker;
  });
});

describe('BlobFallbackTooLargeError', () => {
  it('formats message with GB sizes', () => {
    const err = new BlobFallbackTooLargeError(3 * 1024 * 1024 * 1024, 500 * 1024 * 1024);
    expect(err.name).toBe('BlobFallbackTooLargeError');
    expect(err.bytes).toBe(3 * 1024 * 1024 * 1024);
    expect(err.message).toContain('3.00 GB');
    expect(err.message).toContain('0.49 GB');
  });
});

describe('streamingDownload (blob fallback)', () => {
  beforeEach(() => {
    // Ensure showSaveFilePicker not available to force blob fallback path
    delete (window as any).showSaveFilePicker;
  });

  it('refuses blob fallback when totalSize > cap', async () => {
    await expect(
      streamingDownload(
        { count: 1, fetchChunk: vi.fn() },
        { filename: 'big.bin', totalSize: 600 * 1024 * 1024, blobFallbackMaxBytes: 500 * 1024 * 1024 },
      ),
    ).rejects.toThrow(BlobFallbackTooLargeError);
  });

  it('calls onLargeFileFallback on blob path', async () => {
    const onFallback = vi.fn();
    const mockChunk = new Uint8Array([1, 2, 3]);
    // Mock DOM APIs
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn() as any);
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn() as any);
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test');

    await streamingDownload(
      { count: 1, fetchChunk: () => Promise.resolve(mockChunk) },
      { filename: 'test.bin', onLargeFileFallback: onFallback },
    );

    expect(onFallback).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    URL.createObjectURL = origCreateObjectURL;
    vi.restoreAllMocks();
  });

  it('calls onProgress for each chunk', async () => {
    const onProgress = vi.fn();
    const mockChunk = new Uint8Array([1]);
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    // JSDOM has document.createElement, just need to make the click work
    const origCreateElement = document.createElement;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, _opts?: any) => {
      const el = origCreateElement.call(document, tag, _opts);
      if (tag === 'a') { Object.defineProperty(el, 'click', { value: vi.fn() }); }
      return el;
    });

    await streamingDownload(
      { count: 3, fetchChunk: () => Promise.resolve(mockChunk) },
      { filename: 'test.bin', onProgress },
    );

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(1);

    URL.createObjectURL = origCreateObjectURL;
    vi.restoreAllMocks();
  });
});
