import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { createTestApp, setAuthGate } from '../__tests__/test-utils';

const mockConfig = { get: (k: string) => k === 'APP_URL' ? 'http://localhost:2222' : k === 'NODE_ENV' ? 'development' : null };

describe('OauthController', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    setAuthGate(true);
    svc = { findOrCreateUser: jest.fn(), generateTokens: jest.fn(), unlinkAccount: jest.fn() };
    app = await createTestApp(OauthController, [
      { provide: OauthService, useValue: svc },
      { provide: ConfigService, useValue: mockConfig },
    ]);
  });

  afterEach(() => app.close());

  it('POST /api/oauth/link/google → 401 without auth', async () => {
    setAuthGate(false);
    const res = await request(app.getHttpServer()).post('/api/oauth/link/google');
    expect(res.status).toBe(401);
  });

  it('POST /api/oauth/link/google → returns not-implemented', async () => {
    const res = await request(app.getHttpServer()).post('/api/oauth/link/google').send({ code: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.data.message).toContain('浏览器');
  });

  it('DELETE /api/oauth/unlink → 401 without auth', async () => {
    setAuthGate(false);
    const res = await request(app.getHttpServer()).delete('/api/oauth/unlink');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/oauth/unlink → unlinks google', async () => {
    svc.unlinkAccount.mockResolvedValue({ success: true });
    const res = await request(app.getHttpServer()).delete('/api/oauth/unlink').send({ provider: 'google' });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/oauth/unlink → handles unknown provider', async () => {
    svc.unlinkAccount.mockRejectedValue(new (require('@nestjs/common').BadRequestException)('unknown provider'));
    const res = await request(app.getHttpServer()).delete('/api/oauth/unlink').send({ provider: 'github' });
    expect(res.status).toBe(400);
  });
});
