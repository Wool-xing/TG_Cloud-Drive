import { bufferToHex, hexToBuffer } from './utils';

export async function encryptChunk(chunk: ArrayBuffer, dek: CryptoKey):
  Promise<{ data: ArrayBuffer; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, dek, chunk,
  );
  return { data: encrypted, iv: bufferToHex(iv) };
}

export async function decryptChunk(data: ArrayBuffer, dek: CryptoKey, ivHex: string): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuffer(ivHex) }, dek, data,
  );
}

export async function encryptFile(file: { arrayBuffer(): Promise<ArrayBuffer> }, dek: CryptoKey):
  Promise<{ data: Uint8Array; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, dek, buffer,
  );
  return { data: new Uint8Array(encrypted), iv: bufferToHex(iv) };
}

export async function decryptBuffer(data: ArrayBuffer, dek: CryptoKey, ivHex: string): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuffer(ivHex) }, dek, data,
  );
}
