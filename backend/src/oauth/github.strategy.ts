import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private cs: ConfigService) {
    super({
      clientID: cs.get<string>('OAUTH_GITHUB_CLIENT_ID') || '',
      clientSecret: cs.get<string>('OAUTH_GITHUB_CLIENT_SECRET') || '',
      callbackURL: `${cs.get<string>('APP_URL')}/api/oauth/github/callback`,
      scope: ['user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user: any) => void,
  ) {
    const { id, displayName, username, emails, photos } = profile;
    const user = {
      provider: 'github' as const,
      providerId: id,
      email: emails?.[0]?.value || null,
      name: displayName || username,
      avatar: photos?.[0]?.value || null,
    };
    done(null, user);
  }
}
