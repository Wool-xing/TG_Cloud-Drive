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
      useFactory: async (cs: ConfigService) => {
        // Password is passed as a separate option (rather than baked into
        // REDIS_URL) so passwords containing URL-reserved chars work without
        // encoding tricks. In production, validateEnvOrExit() guarantees this
        // value is present and non-placeholder.
        const password = cs.get<string>('REDIS_PASS') || undefined;
        const client = new Redis(cs.get<string>('REDIS_URL'), {
          password,
          lazyConnect: true,
        });
        // Redis is required for security mechanisms (force-logout, rate-limiting,
        // brute-force lockouts, upload idempotency). Fail-closed: refuse to start
        // without it so these protections cannot silently degrade.
        await client.connect();
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
