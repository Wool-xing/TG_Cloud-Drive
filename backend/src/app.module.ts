import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FilesModule } from './files/files.module';
import { SharesModule } from './shares/shares.module';
import { AdminModule } from './admin/admin.module';
import { TelegramModule } from './telegram/telegram.module';
import { MailModule } from './mail/mail.module';
import { VerificationModule } from './verification/verification.module';
import { WebdavModule } from './webdav/webdav.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './storage/storage.module';
import configuration from './config/configuration';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => {
        // P1-I3: explicit whitelist on NODE_ENV. Pre-fix `!== 'production'`
        // meant any unset / typo'd value (NODE_ENV="prod", undefined, "" )
        // silently enabled schema synchronization — a production deploy that
        // forgot to set the var would let TypeORM rewrite tables on next
        // boot. Whitelist 'development' explicitly; everything else is opt-out
        // unless the operator sets SYNCHRONIZE_DB=true.
        const nodeEnv = cs.get<string>('NODE_ENV');
        if (!nodeEnv) {
          throw new Error('NODE_ENV must be set explicitly (development | production)');
        }
        const explicit = cs.get<string>('SYNCHRONIZE_DB') === 'true';
        const synchronize = nodeEnv === 'development' || explicit;
        if (synchronize && nodeEnv === 'production') {
          throw new Error('synchronize=true is forbidden when NODE_ENV=production');
        }
        return {
          type: 'postgres' as const,
          url: cs.get<string>('DATABASE_URL'),
          autoLoadEntities: true,
          synchronize,
          ssl: cs.get<string>('DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
          logging: nodeEnv === 'development',
        };
      },
    }),

    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    RedisModule,
    StorageModule,
    AuthModule,
    UsersModule,
    FilesModule,
    SharesModule,
    AdminModule,
    TelegramModule,
    MailModule,
    VerificationModule,
    WebdavModule,
  ],
})
export class AppModule {}
