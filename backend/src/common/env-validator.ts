/**
 * Startup environment validation.
 *
 * Enforces:
 *   - Required env vars present and non-empty
 *   - No `CHANGE_ME_*` placeholders left from .env.example
 *   - No known weak / placeholder defaults (see WEAK_DEFAULTS below)
 *   - JWT secrets minimum 32 chars (recommended 64 hex)
 *   - ENCRYPTION_MASTER_KEY exactly 64 hex chars (32 bytes for AES-256)
 *   - APP_URL (production only): real domain, http(s) scheme, not localhost,
 *     not the .env.example `your.domain.com` placeholder
 *
 * Called by main.ts bootstrap before app.listen(). Failures call process.exit(1)
 * with a clear human-readable message — no silent fallbacks.
 *
 * Designed to be reusable by `make doctor` and seed scripts.
 */

interface ValidationError {
  key: string;
  reason: string;
}

/**
 * Known weak / placeholder values that previously shipped as defaults.
 * These are PLACEHOLDERS (never real production credentials) — listing them here
 * lets us detect "user forgot to fill .env" at startup.
 *
 * Per project charter rule: this list MUST NOT contain any real credential that
 * has ever been used in production. See `灵感笔记.md` / charter §0b for the
 * recommended "real-leak detection" pattern via local .security/ file.
 */
const WEAK_DEFAULTS: ReadonlyArray<string> = [
  'change-me-jwt-secret',
  'change-me-refresh-secret',
  'Admin@123456',
  'admin',
  'password',
  '123456',
];

function isPlaceholder(value: string): boolean {
  if (!value) return true;
  if (value.startsWith('CHANGE_ME')) return true;
  if (WEAK_DEFAULTS.includes(value)) return true;
  return false;
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

export function validateEnvOrExit(): void {
  const errors: ValidationError[] = [];

  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_MASTER_KEY',
    'TG_BOT_TOKEN',
    'TG_CHANNEL_ID',
    'ADMIN_USERNAME',
    'ADMIN_INITIAL_PASSWORD',
  ];

  for (const key of required) {
    const value = process.env[key];
    if (!value) {
      errors.push({ key, reason: '未设置（必填）' });
      continue;
    }
    if (isPlaceholder(value)) {
      errors.push({ key, reason: '仍是占位符或已知弱默认值，请改为强随机值' });
    }
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret && !isPlaceholder(jwtSecret) && jwtSecret.length < 32) {
    errors.push({ key: 'JWT_SECRET', reason: `长度 ${jwtSecret.length} 字符，至少 32（推荐 64 hex）` });
  }

  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
  if (jwtRefreshSecret && !isPlaceholder(jwtRefreshSecret) && jwtRefreshSecret.length < 32) {
    errors.push({ key: 'JWT_REFRESH_SECRET', reason: `长度 ${jwtRefreshSecret.length} 字符，至少 32（推荐 64 hex）` });
  }
  if (jwtSecret && jwtRefreshSecret && jwtSecret === jwtRefreshSecret) {
    errors.push({ key: 'JWT_REFRESH_SECRET', reason: '与 JWT_SECRET 相同，必须使用不同密钥' });
  }

  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (masterKey && !isPlaceholder(masterKey)) {
    if (masterKey.length !== 64 || !isHex(masterKey)) {
      errors.push({
        key: 'ENCRYPTION_MASTER_KEY',
        reason: `必须是 64 字符 hex（32 字节）。当前 ${masterKey.length} 字符。生成命令：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      });
    }
  }

  // APP_URL: dev allows the configuration.ts default (http://localhost:5173);
  // production MUST be a real domain — otherwise CORS rejects the real frontend
  // and email/share links point at localhost (broken for end users).
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    const appUrl = process.env.APP_URL;
    if (!appUrl || isPlaceholder(appUrl)) {
      errors.push({
        key: 'APP_URL',
        reason: '生产环境必须设置（指向真实前端域名，例如 https://yourdomain.com）',
      });
    } else if (!/^https?:\/\//.test(appUrl)) {
      errors.push({ key: 'APP_URL', reason: '必须以 http:// 或 https:// 开头' });
    } else if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(appUrl)) {
      errors.push({
        key: 'APP_URL',
        reason: '生产环境不能用 localhost / 127.0.0.1（会导致 CORS 拒绝真实前端 + 邮件链接 404）',
      });
    } else if (/your\.domain\.com|yourdomain\.com/i.test(appUrl)) {
      errors.push({
        key: 'APP_URL',
        reason: '仍是 .env.example 占位（your.domain.com），请改为你的真实前端域名',
      });
    }

    // REDIS_PASS: dev can run Redis without password locally, but production
    // MUST set a strong password. The compose file binds 6379 to 127.0.0.1 only,
    // but defense-in-depth requires Redis auth too — host kernel exploits or
    // sidecar containers could otherwise reach an unauth'd Redis on loopback.
    const redisPass = process.env.REDIS_PASS;
    if (!redisPass || isPlaceholder(redisPass)) {
      errors.push({
        key: 'REDIS_PASS',
        reason: '生产环境必须设置（保护 force-logout / rate-limit / 验证码限流等安全标记）',
      });
    }
  }

  if (errors.length === 0) return;

  // eslint-disable-next-line no-console
  console.error('\n❌ 启动期环境变量校验失败：\n');
  for (const err of errors) {
    // eslint-disable-next-line no-console
    console.error(`  · ${err.key} — ${err.reason}`);
  }
  // eslint-disable-next-line no-console
  console.error('\n请编辑 .env 并按 .env.example 补齐，然后重启服务。详见 启动指南.md 顶部凭据轮换清单。\n');
  process.exit(1);
}
