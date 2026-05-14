import axios from 'axios';
import { create } from 'zustand';
import { UploadTask } from '../types';
import { filesApi } from '../api/client';
import { generateDEK, encryptDEK, encryptChunk, computeFileHash, getSessionMEK, exportDEKAsBase64 } from '../utils/crypto';
import toast from 'react-hot-toast';

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_CONCURRENT = 3;

// P1-F10: bounded-concurrency semaphore for processTask. Pre-fix MAX_CONCURRENT
// was declared but unused — addFiles spawned processTask for every file
// simultaneously, swamping the network + memory with many parallel chunked
// encrypts. Tickets gate task execution; tasks beyond the cap wait their turn.
let __activeUploads__ = 0;
const __uploadQueue__: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (__activeUploads__ < MAX_CONCURRENT) {
    __activeUploads__++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    __uploadQueue__.push(() => {
      __activeUploads__++;
      resolve();
    });
  });
}

function releaseSlot() {
  __activeUploads__--;
  const next = __uploadQueue__.shift();
  if (next) next();
}

// P1-F9: live abort handles by task id. Pause / cancel call `.abort()` to kill
// the in-flight axios request immediately. Not part of zustand state because
// AbortController isn't serialisable and shouldn't be part of the UI snapshot.
const __abortControllers__ = new Map<string, AbortController>();

// P1-F9: per-task DEK material survives pause/resume — regenerating the DEK on
// resume would re-encrypt later chunks under a different key, making the file
// undecryptable. Cleared when the task ends (done / error / cancelled).
interface DEKBundle {
  dek: CryptoKey;
  encryptedDek: string;
  dekIv: string;
  salt: string;
  fileHash: string;
}
const __dekCache__ = new Map<string, DEKBundle>();

interface UploadStore {
  tasks: UploadTask[];
  isOpen: boolean;
  addFiles: (files: File[], parentId: string | null, isPrivate: boolean) => void;
  pauseTask: (id: string) => void;
  resumeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  clearDone: () => void;
  toggleOpen: () => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useUploadStore = create<UploadStore>((set, get) => ({
  tasks: [],
  isOpen: true,

  addFiles: (files, parentId, isPrivate) => {
    const newTasks: UploadTask[] = files.map(file => ({
      id: generateId(),
      file,
      parentId,
      isPrivate: isPrivate || false,
      status: 'pending',
      progress: 0,
      speed: 0,
      uploadedBytes: 0,
    }));
    set(s => ({ tasks: [...s.tasks, ...newTasks], isOpen: true }));
    newTasks.forEach(task => processTask(task.id, set, get));
  },

  pauseTask: (id) => {
    // P1-F9: abort the in-flight chunk *first*, then flip status. Reversing
    // these meant the request kept burning bytes (and budget) until it
    // happened to finish on its own. The AbortError surfaces inside
    // processTask's per-chunk try/catch which exits the loop cleanly.
    __abortControllers__.get(id)?.abort();
    __abortControllers__.delete(id);
    set(s => ({
      tasks: s.tasks.map(t =>
        t.id === id && (t.status === 'uploading' || t.status === 'encrypting')
          ? { ...t, status: 'paused' }
          : t,
      ),
    }));
  },

  resumeTask: (id) => {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.status !== 'paused') return;
    set(s => ({
      tasks: s.tasks.map(t => t.id === id ? { ...t, status: 'pending' } : t),
    }));
    // processTask now reads lastUploadedChunkIndex from the task and seeks
    // forward to that chunk, so already-acked chunks aren't re-uploaded.
    processTask(id, set, get);
  },

  cancelTask: (id) => {
    // P1-F9: kill the in-flight request and free the cached DEK bundle so
    // memory and the slot aren't held indefinitely. Pre-fix `cancel` only
    // removed the task row from the UI; bytes kept flowing.
    __abortControllers__.get(id)?.abort();
    __abortControllers__.delete(id);
    __dekCache__.delete(id);
    set(s => ({
      tasks: s.tasks.filter(t => t.id !== id),
    }));
  },

  clearDone: () => set(s => ({
    tasks: s.tasks.filter(t => t.status !== 'done'),
  })),

  toggleOpen: () => set(s => ({ isOpen: !s.isOpen })),
}));

// P1-F9: any cancellation surfacing from inside the upload loop — either via
// AbortController.abort() or zustand status flipping to paused/cancelled —
// throws this sentinel so the outer catch can distinguish "user-initiated
// halt" (silent return) from "real network error" (toast + status='error').
class UploadHaltedError extends Error {
  constructor(public reason: 'paused' | 'cancelled') {
    super(reason);
    this.name = 'UploadHaltedError';
  }
}

function isAxiosCancelled(err: any): boolean {
  if (axios.isCancel(err)) return true;
  // Axios v1 surfaces aborts as CanceledError; fall back to name/code checks
  // for the rare case where the type guard misses (e.g. wrapped errors).
  return err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED';
}

async function processTask(taskId: string, set: any, get: any) {
  const getTask = () => get().tasks.find((t: UploadTask) => t.id === taskId);
  const updateTask = (update: Partial<UploadTask>) => set((s: any) => ({
    tasks: s.tasks.map((t: UploadTask) => t.id === taskId ? { ...t, ...update } : t),
  }));

  await acquireSlot();
  try {
    const task = getTask();
    if (!task || task.status === 'paused') return;

    // Fail-CLOSED: refuse to upload without MEK. Falling back to plaintext silently
    // would void the E2E encryption promise — better to halt and prompt the user
    // to unlock (log out + log in to re-derive MEK from password).
    // Pairs with backend uploadChunk encryptedDek check.
    const mek = getSessionMEK();
    if (!mek) {
      throw new Error('会话密钥已失效，请退出后重新登录以解锁加密上传（明文上传已被禁用）');
    }

    // P1-F9: derive (or reuse) the DEK + envelope material. On a fresh task we
    // generate; on resume we reuse the cached bundle so already-uploaded chunks
    // remain decryptable. Regenerating mid-file is unrecoverable — the server
    // already has chunks 0..N encrypted under DEK_v1, and chunks N+1..end under
    // DEK_v2 would mean the final file can't be decrypted with either.
    let bundle = __dekCache__.get(taskId);
    if (!bundle) {
      updateTask({ status: 'encrypting', progress: 0 });
      const dek = await generateDEK();
      const { encryptedDek, iv: dekIv, salt } = await encryptDEK(dek, mek);
      const fileHash = await computeFileHash(task.file);
      bundle = { dek, encryptedDek, dekIv, salt, fileHash };
      __dekCache__.set(taskId, bundle);
    }
    const { dek, encryptedDek, dekIv, salt, fileHash } = bundle;

    const totalChunks = Math.ceil(task.file.size / CHUNK_SIZE);
    const idempotencyKey = `${fileHash}-${task.file.name}-${task.file.size}`;

    updateTask({ status: 'uploading' });

    // P1-F9: resume offset. `lastUploadedChunkIndex` is the highest chunk index
    // the server acked (200) — restart at +1. Fresh task: undefined → 0.
    const startIdx = task.lastUploadedChunkIndex !== undefined
      ? task.lastUploadedChunkIndex + 1
      : 0;
    let uploadedBytes = startIdx * CHUNK_SIZE;
    const startTime = Date.now();

    for (let i = startIdx; i < totalChunks; i++) {
      const currentTask = getTask();
      if (!currentTask) throw new UploadHaltedError('cancelled');
      if (currentTask.status === 'paused') throw new UploadHaltedError('paused');

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, task.file.size);
      const slice = task.file.slice(start, end);
      const buffer = await slice.arrayBuffer();

      // Always encrypted — plaintext fallback removed (see MEK gate above).
      const { data: chunkData, iv: chunkIv } = await encryptChunk(buffer, dek);

      // Show encryption progress (0-30% range, scaled across the *remaining*
      // chunks so resume doesn't yo-yo the bar back to 0%).
      const encProgress = Math.round(((i - startIdx + 1) / Math.max(1, totalChunks - startIdx)) * 30);
      updateTask({ progress: Math.max(encProgress, currentTask.progress ?? 0) });

      const formData = new FormData();
      formData.append('chunk', new Blob([chunkData]), 'chunk');
      formData.append('idempotencyKey', idempotencyKey);
      formData.append('chunkIndex', String(i));
      formData.append('totalChunks', String(totalChunks));
      formData.append('filename', task.file.name);
      formData.append('md5', fileHash);
      formData.append('mimeType', task.file.type || 'application/octet-stream');
      formData.append('parentId', task.parentId || '');
      formData.append('private', String(task.isPrivate));
      formData.append('encryptedDek', encryptedDek);
      formData.append('dekIv', dekIv);   // IV for DEK envelope (NodeKey.iv on first chunk)
      formData.append('chunkIv', chunkIv); // IV for THIS chunk's ciphertext (FileChunk.iv)
      formData.append('salt', salt);

      // For progress UI: use ciphertext byte counts (loaded vs encrypted chunk
       // size) — mixing axios `loaded` (ciphertext + GCM auth tag) with
       // task.file.size (plaintext) overshot 100% on big files.
      const encryptedChunkBytes = chunkData.byteLength;
      const plainChunkBytes = end - start;
      let retries = 0;
      while (retries < 5) {
        // P1-F9: fresh controller per chunk attempt. Pause/cancel calls
        // controller.abort() and the in-flight POST throws CanceledError,
        // which we re-raise as UploadHaltedError below.
        const controller = new AbortController();
        __abortControllers__.set(taskId, controller);
        try {
          await filesApi.uploadChunk(formData, (loaded) => {
            // Per-chunk fraction in [0, 1]; clamp to guard against axios
            // reporting loaded > total on the very last byte.
            const chunkFraction = encryptedChunkBytes > 0
              ? Math.min(1, loaded / encryptedChunkBytes)
              : 1;
            // Cumulative plaintext bytes uploaded (for speed display).
            uploadedBytes = start + Math.round(chunkFraction * plainChunkBytes);
            const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
            const speed = uploadedBytes / elapsed;
            // Progress in the 30–100 range; based on chunk index + intra-chunk
            // fraction, NOT byte ratios — so ciphertext overhead can't blow
            // past 100%.
            const progress = Math.min(
              100,
              30 + Math.round(((i + chunkFraction) / totalChunks) * 70),
            );
            updateTask({ uploadedBytes, speed, progress });
          }, controller.signal);
          break;
        } catch (err) {
          if (isAxiosCancelled(err)) {
            // Caused by pauseTask / cancelTask. Map back to whichever status
            // the store now holds so the outer catch handles it correctly.
            const latest = getTask();
            throw new UploadHaltedError(
              latest?.status === 'paused' ? 'paused' : 'cancelled',
            );
          }
          retries++;
          if (retries >= 5) throw err;
          await new Promise(r => setTimeout(r, Math.pow(2, retries) * 1000));
        } finally {
          __abortControllers__.delete(taskId);
        }
      }

      // Server acked chunk i — record it so a later pause/resume picks up at
      // i+1 instead of 0.
      updateTask({ lastUploadedChunkIndex: i });
    }

    updateTask({ status: 'done', progress: 100 });
    toast.success(`${task.file.name} 上传完成`);
    __dekCache__.delete(taskId);
    // P1-F15 followup: File objects themselves are lightweight OS handles —
    // the actual memory pressure came from per-chunk ArrayBuffers, which are
    // already loop-scoped and GC'd after each iteration. The original report
    // overstated "File holds the payload"; verified via empirical test.
    // Keeping File alive for the queue's UI (name/size still shown after done).
  } catch (err: any) {
    if (err instanceof UploadHaltedError) {
      // Pause / cancel — caller already updated status; just exit quietly.
      // DEK bundle stays cached if paused (resume needs it); cancelTask
      // already deleted it on its path.
      return;
    }
    const msg = err?.response?.data?.message || err?.message || '上传失败';
    set((s: any) => ({
      tasks: s.tasks.map((t: UploadTask) => t.id === taskId ? { ...t, status: 'error', error: msg } : t),
    }));
    __dekCache__.delete(taskId);
    toast.error(`上传失败: ${msg}`);
  } finally {
    releaseSlot();
  }
}
