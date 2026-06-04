import { Controller, Get, Post, UseGuards, Req, Res, Delete, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { OauthService } from './oauth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../common/cookie.constants';

@Controller('api/oauth')
export class OauthController {
  constructor(
    private readonly oauthService: OauthService,
    private readonly cs: ConfigService,
  ) {}

  private get frontendUrl(): string {
    return this.cs.get<string>('APP_URL', 'http://localhost:2222');
  }

  private get isProduction(): boolean {
    return this.cs.get<string>('NODE_ENV') === 'production';
  }

  // ── Google ───────────────────────────────────────────────────────────

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Guard redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const user = await this.oauthService.findOrCreateUser(req.user);
    const ip = req.ip || req.socket?.remoteAddress || '';
    const ua = req.headers?.['user-agent'] || '';
    const tokens = await this.oauthService.generateTokens(user, ip, ua);
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions(this.isProduction, true));
    res.redirect(`${this.frontendUrl}/login?accessToken=${tokens.accessToken}`);
  }

  // ── GitHub ───────────────────────────────────────────────────────────

  @Get('github')
  @UseGuards(AuthGuard('github'))
  githubLogin() {
    // Guard redirects to GitHub
  }

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubCallback(@Req() req: any, @Res() res: Response) {
    const user = await this.oauthService.findOrCreateUser(req.user);
    const ip = req.ip || req.socket?.remoteAddress || '';
    const ua = req.headers?.['user-agent'] || '';
    const tokens = await this.oauthService.generateTokens(user, ip, ua);
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions(this.isProduction, true));
    res.redirect(`${this.frontendUrl}/login?accessToken=${tokens.accessToken}`);
  }

  // ── Account linking (requires existing session) ──────────────────────

  @Post('link/google')
  async linkGoogle(@CurrentUser('id') userId: string, @Body('code') code: string) {
    // Not implemented for server-side flow — use the OAuth redirect + state param
    return { message: '请在浏览器中通过跳转方式绑定' };
  }

  @Delete('unlink')
  async unlink(@CurrentUser('id') userId: string, @Body('provider') provider: 'google' | 'github') {
    return this.oauthService.unlinkAccount(userId, provider);
  }
}
