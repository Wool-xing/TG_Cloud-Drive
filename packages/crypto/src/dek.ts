import { bufferToHex, hexToBuffer } from './utils';

export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

export async function encryptDEK(dek: CryptoKey, mek: CryptoKey):
  Promise<{ encryptedDek: string; iv: string; salt: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawDek = await crypto.subtle.exportKey('raw', dek);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, mek, rawDek,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { encryptedDek: bufferToHex(encrypted), iv: bufferToHex(iv), salt: bufferToHex(salt) };
}

export async function decryptDEK(encryptedDekHex: string, ivHex: string, mek: CryptoKey): Promise<CryptoKey> {
  const rawDek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuffer(ivHex) }, mek, hexToBuffer(encryptedDekHex),
  );
  return crypto.subtle.importKey(
    'raw', rawDek, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
