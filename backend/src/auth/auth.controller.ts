import { Controller, Post, Body, Get, Req, Res, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, refreshCookieOptions } from '../common/cookie.constants';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    const result = await this.authService.login(dto, ip, ua);
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(process.env.NODE_ENV === 'production', dto.rememberMe));
    // Strip refreshToken from body — clients receive it only via the HttpOnly cookie.
    const { refreshToken: _drop, ...safe } = result;
    return safe;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: Request) {
    const token = (req as any).cookies?.[REFRESH_COOKIE_NAME];
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    return this.authService.refresh(token, ip, ua);
  }

  // P1-F2: forgot-password flow. Public endpoint, tight per-IP throttle (5/min)
  // matched to /register; bruteforce is further bounded by the per-target
  // verification-code lock (A6) and CAS (A9) inside verificationService.verify.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    return this.authService.resetPassword(dto, ip, ua);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser('deviceId') deviceId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(deviceId);
    res.clearCookie(REFRESH_COOKIE_NAME, {
      path: REFRESH_COOKIE_PATH,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    });
    return result;
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logoutAll(userId);
    res.clearCookie(REFRESH_COOKIE_NAME, {
      path: REFRESH_COOKIE_PATH,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    });
    return result;
  }

  @Get('me')
  @ApiBearerAuth()
  me(@CurrentUser() user: any) {
    return user;
  }
}
