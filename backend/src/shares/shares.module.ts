import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';
import { Share } from './entities/share.entity';
import { Node } from '../files/entities/node.entity';
import { AuditLog } from '../users/entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Share, Node, AuditLog]),
    ConfigModule,
  ],
  controllers: [SharesController],
  providers: [SharesService],
  exports: [SharesService],
})
export class SharesModule {}
