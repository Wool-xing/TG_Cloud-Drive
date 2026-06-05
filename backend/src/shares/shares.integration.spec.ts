import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';
import { createTestApp, setAuthGate } from '../__tests__/test-utils';

describe('SharesController', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    setAuthGate(true);
    svc = { createShare: jest.fn(), listMyShares: jest.fn(), accessShare: jest.fn(), incrementDownload: jest.fn(), getShareToken: jest.fn(), deleteShare: jest.fn() };
    app = await createTestApp(SharesController, [{ provide: SharesService, useValue: svc }]);
  });

  afterEach(() => app.close());

  it('POST /shares → 401 without auth', async () => {
    setAuthGate(false);
    const res = await request(app.getHttpServer()).post('/shares').send({});
    expect(res.status).toBe(401);
  });

  it('POST /shares → creates share', async () => {
    svc.createShare.mockResolvedValue({ id: 's-1', token: 'abc' });
    const res = await request(app.getHttpServer()).post('/shares').send({ nodeId: 'n-1', password: 'pwd' });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBe('abc');
  });

  it('GET /shares/my → lists own shares', async () => {
    svc.listMyShares.mockResolvedValue([{ id: 's-1' }]);
    const res = await request(app.getHttpServer()).get('/shares/my');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /shares/access/:token → accessible without auth (@Public)', async () => {
    setAuthGate(false);
    svc.accessShare.mockResolvedValue({ nodeId: 'n-1', name: 'shared.txt' });
    const res = await request(app.getHttpServer()).get('/shares/access/abc?password=secret');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('shared.txt');
  });

  it('POST /shares/access/:token/download → records download, re-validates password', async () => {
    setAuthGate(false);
    svc.accessShare.mockResolvedValue({ shareId: 's-1' });
    svc.incrementDownload.mockResolvedValue(undefined);
    const res = await request(app.getHttpServer()).post('/shares/access/abc/download').send({ password: 'secret' });
    expect(res.status).toBe(204);
  });

  it('GET /shares/:id/token → returns token for owner', async () => {
    svc.getShareToken.mockResolvedValue({ token: 'full-token' });
    const res = await request(app.getHttpServer()).get('/shares/00000000-0000-0000-0000-000000000001/token');
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('full-token');
  });

  it('DELETE /shares/:id → deactivates', async () => {
    svc.deleteShare.mockResolvedValue({ success: true });
    const res = await request(app.getHttpServer()).delete('/shares/00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(200);
  });
});
