import { Test, TestingModule } from '@nestjs/testing';
import { FileRequestController } from './file-request.controller';
import { FilesService } from './files.service';

describe('FileRequestController', () => {
  let controller: FileRequestController;
  let filesService: Record<string, jest.Mock>;

  beforeEach(async () => {
    filesService = {
      getFileRequest: jest.fn(),
      uploadToFileRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileRequestController],
      providers: [{ provide: FilesService, useValue: filesService }],
    }).compile();

    controller = module.get<FileRequestController>(FileRequestController);
    jest.clearAllMocks();
  });

  describe('GET /file-request/:token', () => {
    it('delegates to filesService.getFileRequest', async () => {
      filesService.getFileRequest.mockResolvedValue({ token: 'abc', maxFiles: 100 });
      const result = await controller.getInfo('abc');
      expect(filesService.getFileRequest).toHaveBeenCalledWith('abc');
      expect(result).toEqual({ token: 'abc', maxFiles: 100 });
    });
  });

  describe('POST /file-request/:token/upload', () => {
    it('delegates to filesService.uploadToFileRequest', async () => {
      const file = { buffer: Buffer.from('hello'), originalname: 'test.txt' } as Express.Multer.File;
      filesService.uploadToFileRequest.mockResolvedValue({ success: true });
      const result = await controller.upload('abc', file);
      expect(filesService.uploadToFileRequest).toHaveBeenCalledWith('abc', Buffer.from('hello'), 'test.txt');
      expect(result).toEqual({ success: true });
    });
  });
});
