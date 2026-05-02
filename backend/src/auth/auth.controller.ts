import { Controller, Post, Body, Get, Req, Res, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    const result = await this.authService.login(dto, ip, ua);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body('refreshToken') token: string, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    return this.authService.refresh(token, ip, ua);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser('deviceId') deviceId: string) {
    return this.authService.logout(deviceId);
  }

  @Post('logout-all')
  @HttpCode(200)
  logoutAll(@CurrentUser('id') userId: string) {
    return this.authService.logoutAll(userId);
  }

  @Get('me')
  @ApiBearerAuth()
  me(@CurrentUser() user: any) {
    return user;
  }
}
