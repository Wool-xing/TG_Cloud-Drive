import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../common/cookie.constants';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    resetPassword: jest.Mock;
    logout: jest.Mock;
    logoutAll: jest.Mock;
    whoAmI: jest.Mock;
  };

  // ── helpers ────────────────────────────────────────────────────────────

  const res = () => {
    const _res: any = {};
    _res.cookie = jest.fn().mockReturnValue(_res);
    _res.clearCookie = jest.fn().mockReturnValue(_res);
    return _res as any;
  };

  const req = (overrides: any = {}) =>
    ({
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'jest' },
      cookies: {},
      ...overrides,
    } as any);

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
      whoAmI: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  // ── register ───────────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('delegates to authService.register with the DTO', async () => {
      const dto = { username: 'neo', password: 'Test1234!', email: 'neo@test.com', code: '111111' };
      authService.register.mockResolvedValue({ id: 'u-1', username: 'neo' });

      const result = await controller.register(dto);
      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'u-1', username: 'neo' });
    });

    it('propagates service errors', async () => {
      authService.register.mockRejectedValue(new Error('dup'));
      await expect(controller.register({ username: 'x', password: 'x' } as any)).rejects.toThrow('dup');
    });
  });

  // ── login ──────────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('calls authService.login with ip and user-agent', async () => {
      const dto = { account: 'neo', password: 'Test1234!', rememberMe: true };
      authService.login.mockResolvedValue({
        accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1' },
      });

      const result = await controller.login(dto as any, req(), res());
      expect(authService.login).toHaveBeenCalledWith(dto, '127.0.0.1', 'jest');
      expect(result).toEqual({ accessToken: 'at', user: { id: 'u-1' } });
      // refreshToken stripped from response body
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('sets HttpOnly refresh cookie', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1' },
      });
      const _res = res();
      await controller.login({ account: 'a', password: 'Test1234!' } as any, req(), _res);
      expect(_res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME, 'rt', expect.objectContaining({ httpOnly: true }),
      );
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('reads refresh token from cookies and delegates', async () => {
      authService.refresh.mockResolvedValue({ accessToken: 'at2' });
      const result = await controller.refresh(req({ cookies: { [REFRESH_COOKIE_NAME]: 'rt' } }));
      expect(authService.refresh).toHaveBeenCalledWith('rt', '127.0.0.1', 'jest');
      expect(result).toEqual({ accessToken: 'at2' });
    });

    it('passes undefined when cookie is missing', async () => {
      authService.refresh.mockResolvedValue({ accessToken: 'at2' });
      await controller.refresh(req());
      expect(authService.refresh).toHaveBeenCalledWith(undefined, '127.0.0.1', 'jest');
    });
  });

  // ── reset-password ─────────────────────────────────────────────────────

  describe('POST /auth/reset-password', () => {
    it('delegates to authService.resetPassword with ip and ua', async () => {
      const dto = { email: 'a@b.com', code: '123456', newPassword: 'New1234!' };
      authService.resetPassword.mockResolvedValue({ success: true });
      const result = await controller.resetPassword(dto as any, req());
      expect(authService.resetPassword).toHaveBeenCalledWith(dto, '127.0.0.1', 'jest');
      expect(result).toEqual({ success: true });
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('delegates to authService.logout with deviceId from CurrentUser', async () => {
      authService.logout.mockResolvedValue({ success: true });
      const _res = res();
      const result = await controller.logout('dev-1', _res);
      expect(authService.logout).toHaveBeenCalledWith('dev-1');
      expect(result).toEqual({ success: true });
    });

    it('clears refresh cookie', async () => {
      const _res = res();
      await controller.logout('dev-1', _res);
      expect(_res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
        path: REFRESH_COOKIE_PATH,
        sameSite: 'strict',
        secure: false, // NODE_ENV !== 'production' in tests
        httpOnly: true,
      });
    });
  });

  // ── logout-all ─────────────────────────────────────────────────────────

  describe('POST /auth/logout-all', () => {
    it('delegates to authService.logoutAll with userId', async () => {
      authService.logoutAll.mockResolvedValue({ success: true });
      const _res = res();
      const result = await controller.logoutAll('u-1', _res);
      expect(authService.logoutAll).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ success: true });
    });

    it('clears refresh cookie', async () => {
      const _res = res();
      await controller.logoutAll('u-1', _res);
      expect(_res.clearCookie).toHaveBeenCalled();
    });
  });

  // ── me ─────────────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    it('returns the CurrentUser object', () => {
      const user = { id: 'u-1', username: 'neo' };
      expect(controller.me(user)).toBe(user);
    });
  });
});
