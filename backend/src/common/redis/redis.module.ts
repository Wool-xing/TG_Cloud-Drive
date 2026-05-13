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
        // Password is passed as a separate option (rather than baked into
        // REDIS_URL) so passwords containing URL-reserved chars work without
        // encoding tricks. In production, validateEnvOrExit() guarantees this
        // value is present and non-placeholder.
        const password = cs.get<string>('REDIS_PASS') || undefined;
        const client = new Redis(cs.get<string>('REDIS_URL'), {
          password,
          lazyConnect: true,
        });
        // NOTE: silent fallback below is INCORRECT for production (the safety
        // mechanisms — force-logout, rate-limiting — depend on Redis being up).
        // Tracked as part of the D7-family fail-close work; not changed here
        // to keep this fix scoped to network/auth surface (B3).
        client.connect().catch(() => console.warn('Redis not available, using in-memory fallback'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
