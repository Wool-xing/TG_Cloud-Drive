import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppController } from './app.controller';
import { createTestApp } from './__tests__/test-utils';

describe('AppController', () => {
  let app: INestApplication;

  beforeEach(async () => { app = await createTestApp(AppController, []); });
  afterEach(() => app.close());

  it('GET /health → { status: ok } with envelope', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual({ status: 'ok' });
  });
});
