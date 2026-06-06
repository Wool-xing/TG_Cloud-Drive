import { setSessionMEK, getSessionMEK, clearSessionMEK } from '../session';

describe('session MEK lifecycle', () => {
  afterEach(() => { clearSessionMEK(); });

  it('returns null when MEK not set', () => {
    expect(getSessionMEK()).toBeNull();
  });

  it('sets and retrieves MEK', async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    );
    setSessionMEK(key);
    expect(getSessionMEK()).toBe(key);
  });

  it('clears MEK', async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    );
    setSessionMEK(key);
    clearSessionMEK();
    expect(getSessionMEK()).toBeNull();
  });

  it('survives multiple set/clear cycles', async () => {
    for (let i = 0; i < 3; i++) {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
      );
      setSessionMEK(key);
      expect(getSessionMEK()).not.toBeNull();
      clearSessionMEK();
      expect(getSessionMEK()).toBeNull();
    }
  });
});
