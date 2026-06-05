import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { FileRequestController } from './file-request.controller';
import { FilesService } from './files.service';
import { createTestApp } from '../__tests__/test-utils';

describe('FileRequestController', () => {
  let app: INestApplication;
  let files: { getFileRequest: jest.Mock; uploadToFileRequest: jest.Mock };

  beforeEach(async () => {
    files = { getFileRequest: jest.fn(), uploadToFileRequest: jest.fn() };
    app = await createTestApp(FileRequestController, [{ provide: FilesService, useValue: files }]);
  });

  afterEach(() => app.close());

  it('GET /file-request/:token → returns info (public)', async () => {
    files.getFileRequest.mockResolvedValue({ token: 'abc', folderName: 'uploads', maxFiles: 100 });
    const res = await request(app.getHttpServer()).get('/file-request/abc');
    expect(res.status).toBe(200);
    expect(res.body.data.maxFiles).toBe(100);
  });

  it('POST /file-request/:token/upload → uploads (public)', async () => {
    files.uploadToFileRequest.mockResolvedValue({ success: true });
    const res = await request(app.getHttpServer()).post('/file-request/abc/upload').attach('file', Buffer.from('c'), 'test.txt');
    expect(res.status).toBe(201);
    expect(res.body.data.success).toBe(true);
  });
});
