import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { REFRESH_COOKIE_NAME } from '../common/cookie.constants';

describe('OauthController', () => {
  let controller: OauthController;
  let oauthService: Record<string, jest.Mock>;
  let mockConfig: { get: jest.Mock };

  const res = () => {
    const _res: any = {};
    _res.cookie = jest.fn().mockReturnValue(_res);
    _res.redirect = jest.fn().mockReturnValue(_res);
    return _res;
  };

  const req = (overrides: any = {}) =>
    ({
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'jest' },
      ...overrides,
    }) as any;

  beforeEach(async () => {
    oauthService = {
      findOrCreateUser: jest.fn(),
      generateTokens: jest.fn(),
      unlinkAccount: jest.fn(),
    };

    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'APP_URL') return 'http://localhost:2222';
        if (key === 'NODE_ENV') return 'development';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OauthController],
      providers: [
        { provide: OauthService, useValue: oauthService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    controller = module.get<OauthController>(OauthController);
    jest.clearAllMocks();
  });

  describe('GET /api/oauth/google/callback', () => {
    it('creates user, generates tokens, sets cookie, redirects', async () => {
      const user = { id: 'u-1', email: 'a@gmail.com' };
      oauthService.findOrCreateUser.mockResolvedValue(user);
      oauthService.generateTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });

      const _res = res();
      const _req = req({ user: { email: 'a@gmail.com' } });

      await (controller as any).googleCallback(_req, _res);

      expect(oauthService.findOrCreateUser).toHaveBeenCalledWith(_req.user);
      expect(oauthService.generateTokens).toHaveBeenCalledWith(user, '127.0.0.1', 'jest');
      expect(_res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME, 'rt', expect.objectContaining({ httpOnly: true }),
      );
      expect(_res.redirect).toHaveBeenCalledWith(
        'http://localhost:2222/login?accessToken=at',
      );
    });
  });

  describe('GET /api/oauth/github/callback', () => {
    it('same flow as google callback', async () => {
      const user = { id: 'u-2', email: null };
      oauthService.findOrCreateUser.mockResolvedValue(user);
      oauthService.generateTokens.mockResolvedValue({ accessToken: 'at2', refreshToken: 'rt2' });

      const _res = res();
      const _req = req({ user: { displayName: 'gh-user' } });

      await (controller as any).githubCallback(_req, _res);

      expect(oauthService.findOrCreateUser).toHaveBeenCalledWith(_req.user);
      expect(_res.cookie).toHaveBeenCalled();
      expect(_res.redirect).toHaveBeenCalledWith(
        'http://localhost:2222/login?accessToken=at2',
      );
    });
  });

  describe('POST /api/oauth/link/google', () => {
    it('returns not-implemented message', async () => {
      const result = await controller.linkGoogle('u-1', 'some-code');
      expect(result).toEqual({ message: '请在浏览器中通过跳转方式绑定' });
    });
  });

  describe('DELETE /api/oauth/unlink', () => {
    it('delegates to oauthService.unlinkAccount', async () => {
      oauthService.unlinkAccount.mockResolvedValue({ success: true });
      const result = await controller.unlink('u-1', 'google');
      expect(oauthService.unlinkAccount).toHaveBeenCalledWith('u-1', 'google');
      expect(result).toEqual({ success: true });
    });
  });
});
