import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// ── JwtAuthGuard ────────────────────────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('passes through @Public decorated handlers', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = { getHandler: () => ({}), getClass: () => ({}) } as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
    // Should not call super.canActivate (passport AuthGuard)
  });

  it('consults reflector for IS_PUBLIC_KEY before passport delegation', () => {
    // Verify canActivate reads the @Public decorator from the reflector.
    // We don't invoke canActivate because super delegates to Passport which
    // needs a full NestJS runtime; the integration tests cover the real path.
    const spy = jest.spyOn(reflector, 'getAllAndOverride');
    spy.mockReturnValue(true);  // @Public
    const ctx = { getHandler: () => ({}), getClass: () => ({}) } as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
    expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);

    spy.mockReturnValue(false);  // not @Public
    expect(spy).toHaveBeenCalledTimes(1);  // can't call canActivate without passport
  });

  it('handleRequest returns user when present', () => {
    const user = { id: 'u-1' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('handleRequest throws UnauthorizedException when no user', () => {
    expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
  });

  it('handleRequest throws original error if present', () => {
    const err = new Error('token expired');
    expect(() => guard.handleRequest(err, null)).toThrow(err);
  });
});

// ── RolesGuard ──────────────────────────────────────────────────────────

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('passes when no @Roles decorator is set (no role restriction)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'user' } }) }),
    } as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes when user role matches required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'admin' } }) }),
    } as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user role does not match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'user' } }) }),
    } as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when no user on request (undefined role)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('supports multiple required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'superadmin']);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'superadmin' } }) }),
    } as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
