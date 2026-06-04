import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { GoogleStrategy } from './google.strategy';
import { GithubStrategy } from './github.strategy';
import { User } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { Subscription } from '../payment/entities/subscription.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Device, Subscription]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get('JWT_SECRET'),
        signOptions: { expiresIn: '2h' },
      }),
    }),
  ],
  controllers: [OauthController],
  providers: [
    OauthService,
    // Only register OAuth strategies when credentials are configured.
    // PassportStrategy with empty clientID crashes on bootstrap.
    ...(process.env.OAUTH_GOOGLE_CLIENT_ID ? [GoogleStrategy] : []),
    ...(process.env.OAUTH_GITHUB_CLIENT_ID ? [GithubStrategy] : []),
  ],
  exports: [OauthService],
})
export class OauthModule {}
