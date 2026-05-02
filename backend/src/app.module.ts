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
import { RedisModule } from './common/redis/redis.module';
import configuration from './config/configuration';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        type: 'postgres',
        url: cs.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: cs.get<string>('NODE_ENV') !== 'production',
        ssl: cs.get<string>('DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        logging: cs.get<string>('NODE_ENV') === 'development',
      }),
    }),

    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    RedisModule,
    AuthModule,
    UsersModule,
    FilesModule,
    SharesModule,
    AdminModule,
    TelegramModule,
    MailModule,
    VerificationModule,
  ],
})
export class AppModule {}
