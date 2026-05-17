import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController } from './files.controller';
import { FileRequestController } from './file-request.controller';
import { FilesService } from './files.service';
import { ExportService } from './export.service';
import { EmbeddingService } from './embedding.service';
import { Node } from './entities/node.entity';
import { FileChunk } from './entities/file-chunk.entity';
import { NodeKey } from './entities/node-key.entity';
import { NodeVersion } from './entities/node-version.entity';
import { FileRequest } from './entities/file-request.entity';
import { Tag } from './entities/tag.entity';
import { NoteTemplate } from './entities/note-template.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { TemplateService } from './template.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, NoteTemplate, User, AuditLog]),
  ],
  controllers: [FilesController, FileRequestController],
  providers: [FilesService, ExportService, EmbeddingService, TemplateService],
  exports: [FilesService],
})
export class FilesModule {}
