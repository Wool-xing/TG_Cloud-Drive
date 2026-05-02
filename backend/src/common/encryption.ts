import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encryptField(plaintext: string, masterKey: string): string {
  const key = Buffer.from(masterKey, 'hex').slice(0, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptField(ciphertext: string, masterKey: string): string {
  const key = Buffer.from(masterKey, 'hex').slice(0, 32);
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.slice(0, 12);
  const tag = data.slice(12, 28);
  const encrypted = data.slice(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function generateSalt(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hmacSign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function hmacVerify(data: string, secret: string, signature: string): boolean {
  const expected = hmacSign(data, secret);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function hashPassword(password: string): Promise<string> {
  const bcrypt = require('bcrypt');
  return bcrypt.hash(password, 12);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  const bcrypt = require('bcrypt');
  return bcrypt.compare(password, hash);
}
