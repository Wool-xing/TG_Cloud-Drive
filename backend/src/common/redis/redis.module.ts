import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => {
        const client = new Redis(cs.get<string>('REDIS_URL'), { lazyConnect: true });
        client.connect().catch(() => console.warn('Redis not available, using in-memory fallback'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
