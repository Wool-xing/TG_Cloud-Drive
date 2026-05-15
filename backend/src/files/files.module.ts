import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { Node } from './entities/node.entity';
import { FileChunk } from './entities/file-chunk.entity';
import { NodeKey } from './entities/node-key.entity';
import { NodeVersion } from './entities/node-version.entity';
import { Tag } from './entities/tag.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Node, FileChunk, NodeKey, NodeVersion, Tag, User, AuditLog]),
    TelegramModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
