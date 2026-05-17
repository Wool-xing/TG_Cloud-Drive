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
