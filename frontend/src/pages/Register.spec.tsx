import { describe, it, expect } from 'vitest';
import { getPasswordStrength } from './Register';

describe('getPasswordStrength', () => {
  it('returns zeros for empty password', () => {
    const r = getPasswordStrength('');
    expect(r.score).toBe(0);
    expect(r.label).toBe('');
  });

  // Display tiers: raw 0-1 → display 1 (weak), raw 2-3 → display 2 (medium), raw 4-5 → display 3 (strong)

  it('length < 8, no other criteria → raw 0 → weak', () => {
    const r = getPasswordStrength('abc');
    expect(r.score).toBe(1);
    expect(r.label).toBe('弱');
  });

  it('length >= 8 only → raw 1 → weak', () => {
    const r = getPasswordStrength('abcdefgh');
    expect(r.score).toBe(1);
  });

  it('length + uppercase → raw 2 → medium', () => {
    const r = getPasswordStrength('Abcdefgh');
    expect(r.score).toBe(2);
    expect(r.label).toBe('中');
  });

  it('length + uppercase + digit → raw 3 → medium', () => {
    const r = getPasswordStrength('Abcdefg1');
    expect(r.score).toBe(2);
  });

  it('length >= 12 + uppercase + digit → raw 4 → strong', () => {
    const r = getPasswordStrength('Abcdefghijk1');
    expect(r.score).toBe(3);
    expect(r.label).toBe('强');
    expect(r.color).toBe('bg-green-500');
  });

  it('all 5 criteria met → raw 5 → strong', () => {
    const r = getPasswordStrength('Abcdefgh!12345');
    expect(r.score).toBe(3);
  });

  it('uppercase without length → raw 1 → weak', () => {
    const r = getPasswordStrength('ABC');
    expect(r.score).toBe(1);
  });

  it('digit + special without length → raw 2 → medium', () => {
    const r = getPasswordStrength('1!@ab');
    expect(r.score).toBe(2);
  });

  it('length >= 12 + digit → raw 2 → medium', () => {
    const r = getPasswordStrength('123456789012');
    expect(r.score).toBe(2);
  });
});
