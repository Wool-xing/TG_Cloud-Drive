// Re-export from shared @tgpan/crypto package
// This file is kept for backward compatibility — all imports from '@/utils/crypto' still work.
export {
  deriveMEK,
  generateDEK,
  encryptDEK,
  decryptDEK,
  encryptChunk,
  decryptChunk,
  encryptFile,
  decryptBuffer,
  computeFileHash,
  setSessionMEK,
  getSessionMEK,
  clearSessionMEK,
  importShareDEK,
  exportDEKAsBase64,
  bufferToHex,
  hexToBuffer,
  formatBytes,
} from '../../../packages/crypto/src';
