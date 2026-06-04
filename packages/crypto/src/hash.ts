import { bufferToHex } from './utils';

export async function computeFileHash(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(hash);
}
