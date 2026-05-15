import { Controller, Get, Post, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { FilesService } from './files.service';

@ApiTags('文件请求（公开）')
@Controller('file-request')
@Public()
export class FileRequestController {
  constructor(private filesService: FilesService) {}

  @Get(':token')
  getInfo(@Param('token') token: string) {
    return this.filesService.getFileRequest(token);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':token/upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }))
  upload(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.filesService.uploadToFileRequest(token, file.buffer, file.originalname);
  }
}
