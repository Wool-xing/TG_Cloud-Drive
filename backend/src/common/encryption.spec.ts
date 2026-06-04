import {
  encryptField, decryptField, generateSalt, generateSecureToken,
  hmacSign, hmacVerify, normalizeEmail, normalizePhone,
  hashPassword, comparePassword,
} from './encryption';

const MASTER_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('encryptField / decryptField', () => {
  it('round-trip', () => {
    const original = 'hello world';
    const enc = encryptField(original, MASTER_KEY);
    expect(enc).not.toBe(original);
    expect(typeof enc).toBe('string');
    expect(decryptField(enc, MASTER_KEY)).toBe(original);
  });

  it('different keys produce different results', () => {
    const enc = encryptField('test', MASTER_KEY);
    expect(() => decryptField(enc, 'wrong-key-16bytesxxx')).toThrow();
  });

  it('handles Unicode', () => {
    const text = '你好世界 🌍';
    expect(decryptField(encryptField(text, MASTER_KEY), MASTER_KEY)).toBe(text);
  });
});

describe('generateSalt', () => {
  it('generates 64-char hex (32 bytes)', () => {
    const salt = generateSalt();
    expect(salt).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(salt)).toBe(true);
  });

  it('generates unique values', () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });
});

describe('generateSecureToken', () => {
  it('default length = 64 hex chars', () => {
    expect(generateSecureToken()).toHaveLength(64);
  });

  it('custom length', () => {
    expect(generateSecureToken(16)).toHaveLength(32);
  });
});

describe('hmacSign / hmacVerify', () => {
  const secret = 'my-secret-key';

  it('verifies correct signature', () => {
    const sig = hmacSign('data', secret);
    expect(hmacVerify('data', secret, sig)).toBe(true);
  });

  it('rejects tampered data', () => {
    const sig = hmacSign('data', secret);
    expect(hmacVerify('tampered', secret, sig)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const sig = hmacSign('data', secret);
    expect(hmacVerify('data', 'wrong-secret', sig)).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('lowercases', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeEmail('  test@test.com  ')).toBe('test@test.com');
  });
});

describe('normalizePhone', () => {
  it('strips whitespace', () => {
    expect(normalizePhone('138 0000 0000')).toBe('13800000000');
  });

  it('passes through clean numbers', () => {
    expect(normalizePhone('13800000000')).toBe('13800000000');
  });
});

describe('hashPassword / comparePassword', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('my-password');
    expect(hash).toContain('$2b$'); // bcrypt
    expect(await comparePassword('my-password', hash)).toBe(true);
    expect(await comparePassword('wrong-password', hash)).toBe(false);
  });
});
