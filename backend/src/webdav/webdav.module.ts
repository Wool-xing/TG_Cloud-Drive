import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Node } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { User } from '../users/entities/user.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { WebdavController } from './webdav.controller';
import { WebdavService } from './webdav.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Node, FileChunk, User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({ secret: cs.get<string>('JWT_SECRET') }),
    }),
    TelegramModule,
  ],
  controllers: [WebdavController],
  providers: [WebdavService],
})
export class WebdavModule {}
