import { CookieOptions } from 'express';

// Refresh token cookie config — shared by auth.controller and oauth.controller.
// HttpOnly: XSS-injected JS can't read it. Access token still lives in
// localStorage; attacker who pulls it gets ≤2h of access but can't mint new
// tokens. path=/api/auth restricts the cookie to refresh + logout endpoints so
// it isn't sent on every API request. sameSite=strict blocks CSRF on the
// refresh endpoint; frontend is same-origin via nginx so this doesn't break
// legitimate flows.
export const REFRESH_COOKIE_NAME = 'rt';
export const REFRESH_COOKIE_PATH = '/api/auth';
export const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // mirrors refresh JWT TTL

export function refreshCookieOptions(isProduction: boolean, persist = true): CookieOptions {
  const opts: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
  if (persist) {
    opts.maxAge = REFRESH_COOKIE_MAX_AGE_MS;
  }
  // persist=false → session cookie, cleared when browser closes ("rememberMe" off)
  return opts;
}
