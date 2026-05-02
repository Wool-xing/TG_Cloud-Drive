// End-to-end encryption using Web Crypto API (AES-256-GCM)
// MEK (Master Encryption Key) is derived from user password via PBKDF2 - never sent to server
// DEK (Data Encryption Key) is generated per file, encrypted with MEK, stored on server

const PBKDF2_ITERATIONS = 310_000;

// Derive MEK from password + salt (same as server side, pure client)
export async function deriveMEK(password: string, saltHex: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const salt = hexToBuffer(saltHex);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Generate a new random DEK
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// Encrypt DEK with MEK, returns { encryptedDek, iv, salt } (all hex strings)
export async function encryptDEK(dek: CryptoKey, mek: CryptoKey): Promise<{ encryptedDek: string; iv: string; salt: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawDek = await crypto.subtle.exportKey('raw', dek);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, mek, rawDek);
  return { encryptedDek: bufferToHex(encrypted), iv: bufferToHex(iv), salt: bufferToHex(new Uint8Array(0)) };
}

// Decrypt DEK with MEK
export async function decryptDEK(encryptedDekHex: string, ivHex: string, mek: CryptoKey): Promise<CryptoKey> {
  const encryptedDek = hexToBuffer(encryptedDekHex);
  const iv = hexToBuffer(ivHex);
  const rawDek = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, mek, encryptedDek);
  return crypto.subtle.importKey('raw', rawDek, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Encrypt a chunk buffer with DEK
export async function encryptChunk(chunk: ArrayBuffer, dek: CryptoKey): Promise<{ data: ArrayBuffer; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, chunk);
  return { data: encrypted, iv: bufferToHex(iv) };
}

// Decrypt a chunk buffer with DEK
export async function decryptChunk(data: ArrayBuffer, dek: CryptoKey, ivHex: string): Promise<ArrayBuffer> {
  const iv = hexToBuffer(ivHex);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, data);
}

// Encrypt entire file (for small files only, large files use chunk streaming)
export async function encryptFile(file: File, dek: CryptoKey): Promise<{ data: Uint8Array; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, buffer);
  return { data: new Uint8Array(encrypted), iv: bufferToHex(iv) };
}

// Decrypt downloaded file data
export async function decryptBuffer(data: ArrayBuffer, dek: CryptoKey, ivHex: string): Promise<ArrayBuffer> {
  const iv = hexToBuffer(ivHex);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, data);
}

// Compute MD5 of file (using SHA-256 as MD5 is not available in Web Crypto)
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(hash);
}

// Session MEK cache (in-memory, cleared on logout)
let sessionMEK: CryptoKey | null = null;
let sessionMEKSalt: string | null = null;

export function setSessionMEK(mek: CryptoKey, salt: string) {
  sessionMEK = mek;
  sessionMEKSalt = salt;
}

export function getSessionMEK(): CryptoKey | null {
  return sessionMEK;
}

export function clearSessionMEK() {
  sessionMEK = null;
  sessionMEKSalt = null;
}

// Convert share key fragment (base64) to CryptoKey for file decryption
export async function importShareDEK(base64Dek: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Dek), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

// Export DEK as base64 (for share key fragment embedding)
export async function exportDEKAsBase64(dek: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', dek);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  return Array.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBuffer(hex: string): Uint8Array {
  if (!hex || hex.length === 0) return new Uint8Array(0);
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
