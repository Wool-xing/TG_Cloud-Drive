import { Controller, Get, Post, UseGuards, Req, Res, Delete, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { OauthService } from './oauth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/oauth')
export class OauthController {
  constructor(private readonly oauthService: OauthService) {}

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
    const tokens = this.oauthService.generateTokens(user);
    const frontendUrl = process.env.APP_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`);
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
    const tokens = this.oauthService.generateTokens(user);
    const frontendUrl = process.env.APP_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`);
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
