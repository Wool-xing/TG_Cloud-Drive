import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { RedisModule } from '../common/redis/redis.module';

// P1-I6: mail service now depends on Redis for daily quota bucket.
@Module({ imports: [RedisModule], providers: [MailService], exports: [MailService] })
export class MailModule {}
