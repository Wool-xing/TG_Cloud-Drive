import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { createTestApp, setAuthGate } from '../__tests__/test-utils';

const UUID = '00000000-0000-0000-0000-000000000001';

describe('AdminController', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  beforeEach(async () => {
    setAuthGate(true);
    svc = {
      getDashboard: jest.fn(), listUsers: jest.fn(), createUser: jest.fn(),
      updateUser: jest.fn(), deleteUser: jest.fn(), forceLogout: jest.fn(),
      listAllFiles: jest.fn(), deleteFileAdmin: jest.fn(),
      getAuditLogs: jest.fn(), getSystemConfig: jest.fn(), updateSystemConfig: jest.fn(),
      testEmail: jest.fn(), testSms: jest.fn(), testVerifyCode: jest.fn(),
    };
    app = await createTestApp(AdminController, [{ provide: AdminService, useValue: svc }]);
  });

  afterEach(() => app.close());

  it('GET /admin/dashboard → 401 without auth', async () => {
    setAuthGate(false);
    const res = await request(app.getHttpServer()).get('/admin/dashboard');
    expect(res.status).toBe(401);
  });

  it('GET /admin/dashboard → returns stats', async () => {
    svc.getDashboard.mockResolvedValue({ users: 100, files: 500 });
    const res = await request(app.getHttpServer()).get('/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.users).toBe(100);
  });

  it('GET /admin/users → pagination + search', async () => {
    svc.listUsers.mockResolvedValue({ items: [], total: 0 });
    const res = await request(app.getHttpServer()).get('/admin/users?page=3&limit=10&search=neo');
    expect(res.status).toBe(200);
    expect(svc.listUsers).toHaveBeenCalledWith(3, 10, 'neo');
  });

  it('POST /admin/users → creates user', async () => {
    svc.createUser.mockResolvedValue({ id: 'u-new' });
    const res = await request(app.getHttpServer()).post('/admin/users').send({ username: 'n', password: 'Test1234!', role: 'user' });
    expect(res.status).toBe(201);
  });

  it('PATCH + DELETE /admin/users/:id → update + delete', async () => {
    svc.updateUser.mockResolvedValue({ success: true });
    svc.deleteUser.mockResolvedValue({ success: true });

    let res = await request(app.getHttpServer()).patch(`/admin/users/${UUID}`).send({ role: 'admin' });
    expect(res.status).toBe(200);

    res = await request(app.getHttpServer()).delete(`/admin/users/${UUID}`).send({ confirmPassword: 'AdminPass1!' });
    expect(res.status).toBe(200);
  });

  it('GET /admin/files → file browser', async () => {
    svc.listAllFiles.mockResolvedValue({ items: [], total: 0 });
    const res = await request(app.getHttpServer()).get('/admin/files?page=1&limit=50&type=image');
    expect(res.status).toBe(200);
  });

  it('GET + PATCH /admin/config → system config', async () => {
    svc.getSystemConfig.mockResolvedValue({ appName: 'TG' });
    svc.updateSystemConfig.mockResolvedValue({ success: true });

    let res = await request(app.getHttpServer()).get('/admin/config');
    expect(res.status).toBe(200);
    expect(res.body.data.appName).toBe('TG');

    res = await request(app.getHttpServer()).patch('/admin/config').send({ appName: 'N', confirmPassword: 'pwd' });
    expect(res.status).toBe(200);
  });

  it('POST /admin/test-email /test-sms /test-verify', async () => {
    svc.testEmail.mockResolvedValue({ sent: true });
    svc.testSms.mockResolvedValue({ sent: true, devCode: '123456' });
    svc.testVerifyCode.mockResolvedValue({ valid: true });

    expect((await request(app.getHttpServer()).post('/admin/test-email').send({ to: 'a@b.com' })).status).toBe(200);
    expect((await request(app.getHttpServer()).post('/admin/test-sms').send({ to: '13800138000' })).status).toBe(200);
    expect((await request(app.getHttpServer()).post('/admin/test-verify').send({ channel: 'email', code: '123456' })).status).toBe(200);
  });
});
