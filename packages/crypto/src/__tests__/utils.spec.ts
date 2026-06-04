import { bufferToHex, hexToBuffer, formatBytes } from '../utils';

describe('bufferToHex', () => {
  it('converts empty buffer', () => {
    expect(bufferToHex(new Uint8Array(0))).toBe('');
  });

  it('converts buffer to hex string', () => {
    const buf = new Uint8Array([0xab, 0xcd, 0xef]);
    expect(bufferToHex(buf)).toBe('abcdef');
  });

  it('zero-pads single digits', () => {
    expect(bufferToHex(new Uint8Array([0x0a, 0x01]))).toBe('0a01');
  });
});

describe('hexToBuffer', () => {
  it('returns empty for empty input', () => {
    expect(hexToBuffer('')).toEqual(new Uint8Array(0));
  });

  it('converts hex to buffer round-trip', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = bufferToHex(original);
    expect(hexToBuffer(hex)).toEqual(original);
  });
});

describe('formatBytes', () => {
  it('handles zero', () => expect(formatBytes(0)).toBe('0 B'));
  it('formats bytes', () => expect(formatBytes(500)).toBe('500.00 B'));
  it('formats KB', () => expect(formatBytes(2048)).toBe('2.00 KB'));
  it('formats MB', () => expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB'));
  it('formats GB', () => expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.50 GB'));
});
