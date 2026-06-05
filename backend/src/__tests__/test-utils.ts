import { Test } from '@nestjs/testing';
import { ValidationPipe, CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

// ── Shared auth gate ─────────────────────────────────────────────────────

let __authGate = true;

export const setAuthGate = (v: boolean) => { __authGate = v; };

export class IntegrationGuard implements CanActivate {
  private reflector = new Reflector();

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;
    if (!__authGate) throw new (require('@nestjs/common').UnauthorizedException)('请先登录');
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'u-1', username: 'tester', deviceId: 'dev-1' };
    return true;
  }
}

// ── Shared app builder ───────────────────────────────────────────────────

export interface MockServices {
  [key: symbol | string]: Record<string, jest.Mock>;
}

export async function createTestApp(
  controller: any,
  providers: Array<{ provide: any; useValue: Record<string, any> }>,
  opts?: { needsCookieParser?: boolean; rawBody?: boolean },
): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    controllers: [controller],
    providers,
  }).compile();

  const app = mod.createNestApplication({ rawBody: opts?.rawBody ?? false });
  if (opts?.needsCookieParser !== false) app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalGuards(new IntegrationGuard());
  return app.init();
}
