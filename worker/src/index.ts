/**
 * Cloudflare Worker — TG Pan Proxy
 *
 * Routes:
 *   POST /upload-chunk        — Upload a file chunk to the Telegram channel
 *   GET  /file/:token         — Serve a file (with Range support) using a signed token
 *   GET  /api/tg/:method      — Proxy GET Telegram Bot API calls
 *   POST /api/tg/:method      — Proxy POST Telegram Bot API calls
 *
 * Authentication:
 *   • /upload-chunk and /api/tg/* require the X-Workers-Secret header.
 *   • /file/:token uses a short-lived HMAC-signed token embedded in the URL.
 *
 * Env bindings (set via `wrangler secret put`):
 *   TG_BOT_TOKEN      — Telegram Bot API token
 *   TG_CHANNEL_ID     — Default channel/chat id for uploads
 *   CF_WORKERS_SECRET — Shared secret for X-Workers-Secret header & token signing
 */

export interface Env {
  TG_BOT_TOKEN: string;
  TG_CHANNEL_ID: string;
  CF_WORKERS_SECRET: string;
}

// ─── CORS helpers ────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Workers-Secret, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function corsError(message: string, status: number): Response {
  return corsJson({ ok: false, error: message }, status);
}

// ─── HMAC helpers (Web Crypto) ────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bufToHex(sig);
}

async function hmacVerify(data: string, secret: string, signature: string): Promise<boolean> {
  const key = await importHmacKey(secret);
  const sigBuf = hexToBuf(signature);
  if (!sigBuf) return false;
  return crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(data));
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): ArrayBuffer | null {
  if (hex.length % 2 !== 0) return null;
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    buf[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return buf.buffer;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

interface FileToken {
  fileId: string;
  exp: number;      // unix seconds
  sig: string;      // hex HMAC over "{fileId}.{exp}"
}

async function createFileToken(fileId: string, secret: string, ttlSeconds = 3600): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${fileId}.${exp}`;
  const sig = await hmacSign(payload, secret);
  const token: FileToken = { fileId, exp, sig };
  return btoa(JSON.stringify(token))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function verifyFileToken(raw: string, secret: string): Promise<FileToken | null> {
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const token: FileToken = JSON.parse(json);
    if (!token.fileId || !token.exp || !token.sig) return null;
    if (Math.floor(Date.now() / 1000) > token.exp) return null; // expired
    const payload = `${token.fileId}.${token.exp}`;
    const valid = await hmacVerify(payload, secret, token.sig);
    return valid ? token : null;
  } catch {
    return null;
  }
}

// ─── Secret validation ────────────────────────────────────────────────────────

function validateSecret(request: Request, env: Env): boolean {
  const header = request.headers.get('X-Workers-Secret');
  if (!header) return false;
  // Constant-time comparison via encoding trick
  const a = new TextEncoder().encode(header);
  const b = new TextEncoder().encode(env.CF_WORKERS_SECRET);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ─── Upload chunk ─────────────────────────────────────────────────────────────

async function handleUploadChunk(request: Request, env: Env): Promise<Response> {
  if (!validateSecret(request, env)) {
    return corsError('Unauthorized', 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return corsError('Invalid form data', 400);
  }

  const document = formData.get('document') as File | null;
  const filename = (formData.get('filename') as string) || 'chunk.bin';
  const contentType = (formData.get('content_type') as string) || 'application/octet-stream';
  const chatId = (formData.get('chat_id') as string) || env.TG_CHANNEL_ID;

  if (!document) {
    return corsError('Missing document field', 400);
  }

  // Build multipart form for Telegram sendDocument
  const tgForm = new FormData();
  tgForm.set('chat_id', chatId);
  tgForm.set('document', new File([await document.arrayBuffer()], filename, { type: contentType }));

  const tgRes = await fetch(
    `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendDocument`,
    { method: 'POST', body: tgForm },
  );

  const tgJson = await tgRes.json() as any;
  if (!tgJson.ok) {
    return corsError(`Telegram error: ${tgJson.description ?? 'unknown'}`, 502);
  }

  const message = tgJson.result;
  const fileId: string =
    message?.document?.file_id ??
    message?.video?.file_id ??
    message?.audio?.file_id ??
    message?.photo?.at(-1)?.file_id ??
    null;

  if (!fileId) {
    return corsError('Could not extract file_id from Telegram response', 502);
  }

  // Generate a signed access token for later retrieval
  const accessToken = await createFileToken(fileId, env.CF_WORKERS_SECRET);

  return corsJson({
    ok: true,
    fileId,
    messageId: message.message_id,
    accessToken,
    size: message?.document?.file_size ?? null,
  });
}

// ─── File serving with Range support ─────────────────────────────────────────

async function handleFileServe(token: string, request: Request, env: Env): Promise<Response> {
  const verified = await verifyFileToken(token, env.CF_WORKERS_SECRET);
  if (!verified) {
    return corsError('Invalid or expired file token', 403);
  }

  const { fileId } = verified;

  // Resolve file_path via getFile
  const getFileRes = await fetch(
    `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const getFileJson = await getFileRes.json() as any;
  if (!getFileJson.ok) {
    return corsError(`Telegram getFile error: ${getFileJson.description ?? 'unknown'}`, 502);
  }

  const filePath: string = getFileJson.result?.file_path;
  if (!filePath) {
    return corsError('file_path not available', 502);
  }

  const fileUrl = `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;

  // Forward Range header if present (enables video seek)
  const rangeHeader = request.headers.get('Range');
  const upstreamHeaders: Record<string, string> = {};
  if (rangeHeader) {
    upstreamHeaders['Range'] = rangeHeader;
  }

  const fileRes = await fetch(fileUrl, { headers: upstreamHeaders });

  // Build response preserving status and content headers
  const responseHeaders = new Headers();
  const forwardHeaders = [
    'Content-Type', 'Content-Length', 'Content-Range',
    'Accept-Ranges', 'Last-Modified', 'ETag',
  ];
  for (const h of forwardHeaders) {
    const v = fileRes.headers.get(h);
    if (v) responseHeaders.set(h, v);
  }
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(k, v);
  }

  return new Response(fileRes.body, {
    status: fileRes.status,
    statusText: fileRes.statusText,
    headers: responseHeaders,
  });
}

// ─── Telegram API proxy ───────────────────────────────────────────────────────

async function handleTgProxy(
  method: string,
  request: Request,
  env: Env,
): Promise<Response> {
  if (!validateSecret(request, env)) {
    return corsError('Unauthorized', 401);
  }

  const tgBase = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`;

  if (request.method === 'GET') {
    // Forward query params; inject chat_id if absent
    const inUrl = new URL(request.url);
    const params = new URLSearchParams(inUrl.searchParams);
    if (!params.has('chat_id')) params.set('chat_id', env.TG_CHANNEL_ID);

    const res = await fetch(`${tgBase}?${params.toString()}`);
    const json = await res.json();
    return corsJson(json, res.status);
  }

  // POST: handle both JSON and FormData bodies
  const contentType = request.headers.get('Content-Type') ?? '';

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    if (!form.has('chat_id')) form.set('chat_id', env.TG_CHANNEL_ID);
    const res = await fetch(tgBase, { method: 'POST', body: form });
    const json = await res.json();
    return corsJson(json, res.status);
  }

  // Default: JSON body
  let body: Record<string, any> = {};
  try {
    body = await request.json();
  } catch {
    // empty or invalid JSON — proceed with empty body
  }

  if (!('chat_id' in body)) {
    body.chat_id = env.TG_CHANNEL_ID;
  }

  const res = await fetch(tgBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return corsJson(json, res.status);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function handler(request: Request, env: Env): Promise<Response> {
  // Preflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const { pathname } = url;

  try {
    // POST /upload-chunk
    if (request.method === 'POST' && pathname === '/upload-chunk') {
      return await handleUploadChunk(request, env);
    }

    // GET /file/:token
    const fileMatch = pathname.match(/^\/file\/([A-Za-z0-9\-_]+)$/);
    if (fileMatch && request.method === 'GET') {
      return await handleFileServe(fileMatch[1], request, env);
    }

    // GET|POST /api/tg/:method
    const tgMatch = pathname.match(/^\/api\/tg\/(.+)$/);
    if (tgMatch && (request.method === 'GET' || request.method === 'POST')) {
      return await handleTgProxy(tgMatch[1], request, env);
    }

    // Health check
    if (pathname === '/health' && request.method === 'GET') {
      return corsJson({ ok: true, timestamp: Date.now() });
    }

    return corsError('Not Found', 404);
  } catch (err: any) {
    console.error('Worker error:', err);
    return corsError(`Internal Server Error: ${err?.message ?? 'unknown'}`, 500);
  }
}

export default { fetch: handler };
