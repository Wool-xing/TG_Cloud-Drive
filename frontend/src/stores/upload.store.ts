import { create } from 'zustand';
import { UploadTask } from '../types';
import { v4 as uuid } from 'crypto';
import { filesApi } from '../api/client';
import { generateDEK, encryptDEK, encryptChunk, computeFileHash, getSessionMEK, exportDEKAsBase64 } from '../utils/crypto';
import toast from 'react-hot-toast';

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_CONCURRENT = 3;

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

  pauseTask: (id) => set(s => ({
    tasks: s.tasks.map(t => t.id === id && t.status === 'uploading' ? { ...t, status: 'paused' } : t),
  })),

  resumeTask: (id) => {
    set(s => ({
      tasks: s.tasks.map(t => t.id === id && t.status === 'paused' ? { ...t, status: 'pending' } : t),
    }));
    const task = get().tasks.find(t => t.id === id);
    if (task) processTask(id, set, get);
  },

  cancelTask: (id) => set(s => ({
    tasks: s.tasks.filter(t => t.id !== id),
  })),

  clearDone: () => set(s => ({
    tasks: s.tasks.filter(t => t.status !== 'done'),
  })),

  toggleOpen: () => set(s => ({ isOpen: !s.isOpen })),
}));

async function processTask(taskId: string, set: any, get: any) {
  const getTask = () => get().tasks.find((t: UploadTask) => t.id === taskId);
  const updateTask = (update: Partial<UploadTask>) => set((s: any) => ({
    tasks: s.tasks.map((t: UploadTask) => t.id === taskId ? { ...t, ...update } : t),
  }));

  try {
    const task = getTask();
    if (!task || task.status === 'paused') return;

    updateTask({ status: 'encrypting', progress: 0 });

    const mek = getSessionMEK();
    const dek = await generateDEK();
    let encryptedDek = '';
    let iv = '';
    let salt = '';

    if (mek) {
      const dekInfo = await encryptDEK(dek, mek);
      encryptedDek = dekInfo.encryptedDek;
      iv = dekInfo.iv;
      salt = dekInfo.salt;
    }

    const fileHash = await computeFileHash(task.file);
    const totalChunks = Math.ceil(task.file.size / CHUNK_SIZE);
    const idempotencyKey = `${fileHash}-${task.file.name}-${task.file.size}`;

    updateTask({ status: 'uploading' });

    let uploadedBytes = 0;
    const startTime = Date.now();

    for (let i = 0; i < totalChunks; i++) {
      const currentTask = getTask();
      if (!currentTask || currentTask.status === 'paused') return;

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, task.file.size);
      const slice = task.file.slice(start, end);
      const buffer = await slice.arrayBuffer();

      let chunkData: ArrayBuffer;
      let chunkIv = '';
      if (mek) {
        const encrypted = await encryptChunk(buffer, dek);
        chunkData = encrypted.data;
        chunkIv = encrypted.iv;
      } else {
        chunkData = buffer;
      }
      // Show encryption progress (0-30% range)
      updateTask({ progress: Math.round(((i + 1) / totalChunks) * 30) });

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
      if (mek) {
        formData.append('encryptedDek', encryptedDek);
        formData.append('iv', chunkIv || iv);
        formData.append('salt', salt);
      }

      let retries = 0;
      while (retries < 5) {
        try {
          await filesApi.uploadChunk(formData, (loaded) => {
            const delta = loaded - (i === 0 ? 0 : uploadedBytes % CHUNK_SIZE);
            uploadedBytes = start + loaded;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = uploadedBytes / elapsed;
            const progress = 30 + Math.round((uploadedBytes / task.file.size) * 70);
            updateTask({ uploadedBytes, speed, progress });
          });
          break;
        } catch (err) {
          retries++;
          if (retries >= 5) throw err;
          await new Promise(r => setTimeout(r, Math.pow(2, retries) * 1000));
        }
      }
    }

    updateTask({ status: 'done', progress: 100 });
    toast.success(`${task.file.name} 上传完成`);
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.message || '上传失败';
    set((s: any) => ({
      tasks: s.tasks.map((t: UploadTask) => t.id === taskId ? { ...t, status: 'error', error: msg } : t),
    }));
    toast.error(`上传失败: ${msg}`);
  }
}
