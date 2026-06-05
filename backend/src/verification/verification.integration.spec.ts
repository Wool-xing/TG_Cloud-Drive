import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VerificationPurpose } from './verification.entity';
import { createTestApp } from '../__tests__/test-utils';

describe('VerificationController', () => {
  let app: INestApplication;
  let svc: { sendCode: jest.Mock };

  beforeEach(async () => {
    svc = { sendCode: jest.fn() };
    app = await createTestApp(VerificationController, [{ provide: VerificationService, useValue: svc }]);
  });

  afterEach(() => app.close());

  it('returns 400 on invalid purpose', async () => {
    const res = await request(app.getHttpServer()).post('/verification/send').send({ target: 'a@b.com', purpose: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('returns 400 missing target', async () => {
    const res = await request(app.getHttpServer()).post('/verification/send').send({ purpose: VerificationPurpose.REGISTER });
    expect(res.status).toBe(400);
  });

  it('sends code for REGISTER', async () => {
    svc.sendCode.mockResolvedValue({ sent: true, code: '123456' });
    const res = await request(app.getHttpServer()).post('/verification/send').send({ target: 'a@b.com', purpose: VerificationPurpose.REGISTER });
    expect(res.status).toBe(201);
    expect(res.body.data.sent).toBe(true);
  });
});
