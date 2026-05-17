export default () => ({
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  // APP_URL dev fallback only; production requires explicit value via validateEnvOrExit().
  APP_URL: process.env.APP_URL || 'http://localhost:5173',

  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL || 'false',

  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // No fallback values for secrets — startup is gated by validateEnvOrExit().
  // Missing or weak values cause process.exit(1) before this code is reached.
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_EXPIRES_IN: '2h',
  JWT_REFRESH_EXPIRES_IN: '30d',

  SENTRY_DSN: process.env.SENTRY_DSN,

  ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY,

  TG_BOT_TOKEN: process.env.TG_BOT_TOKEN,
  TG_CHANNEL_ID: process.env.TG_CHANNEL_ID,
  CF_WORKERS_URL: process.env.CF_WORKERS_URL,
  CF_WORKERS_SECRET: process.env.CF_WORKERS_SECRET,

  // Cloudflare R2 (S3-compatible object storage)
  R2_ENDPOINT: process.env.R2_ENDPOINT,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,

  // Resend (primary email — higher deliverability than raw SMTP)
  RESEND_API_KEY: process.env.RESEND_API_KEY,

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM || 'TG云盘 <noreply@tgpan.com>',

  // No fallback — startup validated; seed script also re-checks.
  ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID,
  STRIPE_BUSINESS_PRICE_ID: process.env.STRIPE_BUSINESS_PRICE_ID,

  OAUTH_GOOGLE_CLIENT_ID: process.env.OAUTH_GOOGLE_CLIENT_ID,
  OAUTH_GOOGLE_CLIENT_SECRET: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
  OAUTH_GITHUB_CLIENT_ID: process.env.OAUTH_GITHUB_CLIENT_ID,
  OAUTH_GITHUB_CLIENT_SECRET: process.env.OAUTH_GITHUB_CLIENT_SECRET,

  DEFAULT_USER_QUOTA_GB: parseInt(process.env.DEFAULT_USER_QUOTA_GB, 10) || 50,

  MAX_FOLDERS_PER_DIR: parseInt(process.env.MAX_FOLDERS_PER_DIR, 10) || 10,
  VERIFICATION_CODE_TTL: 300,
  LOGIN_LOCK_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
  TRASH_RETENTION_DAYS: 30,
});
