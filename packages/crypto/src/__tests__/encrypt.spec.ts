import { generateDEK, encryptDEK, decryptDEK } from '../dek';
import { encryptChunk, decryptChunk } from '../encrypt';
import { deriveMEK } from '../derive';
import { bufferToHex } from '../utils';

const TEST_PASSWORD = 'correct horse battery staple';
const TEST_SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('E2E encryption', () => {
  let mek: CryptoKey;
  let dek: CryptoKey;

  beforeAll(async () => {
    mek = await deriveMEK(TEST_PASSWORD, TEST_SALT);
    dek = await generateDEK();
  });

  it('derives MEK from password + salt', () => {
    expect(mek).toBeDefined();
    expect(mek.type).toBe('secret');
  });

  it('generates random DEK', () => {
    expect(dek).toBeDefined();
    expect(dek.type).toBe('secret');
  });

  it('encrypts and decrypts DEK round-trip', async () => {
    const { encryptedDek, iv, salt } = await encryptDEK(dek, mek);
    // 256-bit key (32 bytes) + GCM auth tag (16 bytes) → 48 bytes → 96 hex
    expect(encryptedDek).toHaveLength(96);
    expect(iv).toHaveLength(24); // 96-bit IV → 12 bytes → 24 hex
    expect(salt).toHaveLength(32);

    const decryptedDek = await decryptDEK(encryptedDek, iv, mek);
    expect(decryptedDek).toBeDefined();
    expect(decryptedDek.type).toBe('secret');
  });

  it('encrypts and decrypts chunk round-trip', async () => {
    const plaintext = new TextEncoder().encode('Hello, TG Cloud! This is test data for encryption.').buffer;
    const { data, iv } = await encryptChunk(plaintext, dek);

    // Encrypted data should differ from plaintext
    const encryptedView = new Uint8Array(data);
    const plainView = new Uint8Array(plaintext);
    expect(encryptedView).not.toEqual(plainView);

    const decrypted = await decryptChunk(data, dek, iv);
    expect(new Uint8Array(decrypted)).toEqual(plainView);
  });

  it('different MEKs produce different derived keys', async () => {
    const mek2 = await deriveMEK('different password', TEST_SALT);
    const { encryptedDek } = await encryptDEK(dek, mek);

    // Decrypting with wrong MEK should fail
    await expect(decryptDEK(encryptedDek, bufferToHex(new Uint8Array(12)), mek2))
      .rejects.toThrow();
  });
});
