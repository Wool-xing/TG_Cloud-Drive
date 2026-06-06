import configuration from './configuration';

describe('configuration', () => {
  const OLD_ENV = process.env;

  beforeEach(() => { process.env = { ...OLD_ENV }; });
  afterAll(() => { process.env = OLD_ENV; });

  it('returns defaults when no env set', () => {
    process.env = {};
    const cfg = configuration();
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.REDIS_URL).toBe('redis://localhost:6379');
    expect(cfg.SMTP_PORT).toBe(587);
    expect(cfg.DEFAULT_USER_QUOTA_GB).toBe(50);
    expect(cfg.VERIFICATION_CODE_TTL).toBe(300);
    expect(cfg.LOGIN_LOCK_ATTEMPTS).toBe(5);
    expect(cfg.LOGIN_LOCK_MINUTES).toBe(15);
    expect(cfg.TRASH_RETENTION_DAYS).toBe(30);
  });

  it('reads PORT from env', () => {
    process.env = { PORT: '8080' };
    expect(configuration().PORT).toBe(8080);
  });

  it('reads numeric env vars', () => {
    process.env = {
      SMTP_PORT: '465',
      DEFAULT_USER_QUOTA_GB: '100',
      MAX_FOLDERS_PER_DIR: '20',
      AUTO_VERSION_LIMIT: '5',
    };
    const cfg = configuration();
    expect(cfg.SMTP_PORT).toBe(465);
    expect(cfg.DEFAULT_USER_QUOTA_GB).toBe(100);
    expect(cfg.MAX_FOLDERS_PER_DIR).toBe(20);
    expect(cfg.AUTO_VERSION_LIMIT).toBe(5);
  });

  it('passes through secret values from env', () => {
    process.env = {
      JWT_SECRET: 'my-secret',
      TG_BOT_TOKEN: '123:abc',
      ENCRYPTION_MASTER_KEY: 'a'.repeat(64),
    };
    const cfg = configuration();
    expect(cfg.JWT_SECRET).toBe('my-secret');
    expect(cfg.TG_BOT_TOKEN).toBe('123:abc');
  });

  it('handles NaN gracefully for numeric defaults', () => {
    process.env = { PORT: 'not-a-number', SMTP_PORT: 'abc' };
    const cfg = configuration();
    expect(cfg.PORT).toBe(3000); // fallback
    expect(cfg.SMTP_PORT).toBe(587); // fallback
  });

  it('reads APP_URL from env', () => {
    process.env = { APP_URL: 'https://drive.example.com' };
    expect(configuration().APP_URL).toBe('https://drive.example.com');
  });
});
