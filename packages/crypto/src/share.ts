export async function importShareDEK(base64Dek: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Dek), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
}

export async function exportDEKAsBase64(dek: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', dek);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}
