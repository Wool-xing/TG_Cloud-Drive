import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CollaborationGateway } from './collaboration.gateway';
import { CollaborationService } from './collaboration.service';
import { Node } from '../files/entities/node.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Node]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  providers: [CollaborationGateway, CollaborationService],
  exports: [CollaborationService],
})
export class CollaborationModule {}
