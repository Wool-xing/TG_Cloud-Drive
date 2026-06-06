import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { WebdavService } from './webdav.service';
import { Node, NodeType } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { NodeKey } from '../files/entities/node-key.entity';
import { User, UserStatus } from '../users/entities/user.entity';
import { StorageService } from '../storage/storage.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('WebdavService', () => {
  let service: WebdavService;
  let nodeRepo: any;

  const mockStorage = { getPrimary: jest.fn(() => 'telegram'), getUrl: jest.fn(), upload: jest.fn() };

  beforeEach(async () => {
    nodeRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      providers: [
        WebdavService,
        { provide: getRepositoryToken(Node), useValue: nodeRepo },
        { provide: getRepositoryToken(FileChunk), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(), increment: jest.fn() } },
        { provide: getRepositoryToken(NodeKey), useValue: { findOne: jest.fn() } },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(WebdavService);
  });

  describe('resolvePath', () => {
    it('returns null for root path', async () => {
      const result = await (service as any).resolvePath('user-1', '/');
      expect(result).toBeNull();
    });

    it('returns null for empty path', async () => {
      const result = await (service as any).resolvePath('user-1', '');
      expect(result).toBeNull();
    });

    it('resolves single-level folder', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'f-1', name: 'docs', type: NodeType.FOLDER });
      const result = await (service as any).resolvePath('user-1', 'docs');
      expect(result).toMatchObject({ id: 'f-1', name: 'docs' });
    });

    it('resolves nested path', async () => {
      nodeRepo.findOne
        .mockResolvedValueOnce({ id: 'f-1', name: 'docs', type: NodeType.FOLDER })
        .mockResolvedValueOnce({ id: 'f-2', name: 'sub', type: NodeType.FOLDER });
      const result = await (service as any).resolvePath('user-1', 'docs/sub');
      expect(result).toMatchObject({ id: 'f-2', name: 'sub' });
    });

    it('returns null when segment not found', async () => {
      nodeRepo.findOne.mockResolvedValueOnce({ id: 'f-1', name: 'docs', type: NodeType.FOLDER });
      nodeRepo.findOne.mockResolvedValueOnce(null);
      const result = await (service as any).resolvePath('user-1', 'docs/nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('resolveFile', () => {
    it('finds file in root', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'n-1', name: 'test.txt', type: NodeType.FILE });
      const result = await (service as any).resolveFile('user-1', 'test.txt');
      expect(result).toMatchObject({ name: 'test.txt' });
    });

    it('returns null for non-existent file', async () => {
      nodeRepo.findOne.mockResolvedValue(null);
      const result = await (service as any).resolveFile('user-1', 'missing.txt');
      expect(result).toBeNull();
    });

    it('finds file in subfolder', async () => {
      nodeRepo.findOne
        .mockResolvedValueOnce({ id: 'f-1', name: 'docs', type: NodeType.FOLDER })
        .mockResolvedValueOnce({ id: 'n-2', name: 'doc.pdf', type: NodeType.FILE });
      const result = await (service as any).resolveFile('user-1', 'docs/doc.pdf');
      expect(result).toMatchObject({ name: 'doc.pdf' });
    });
  });

  describe('isDescendant', () => {
    it('detects direct child', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'child', parentId: 'parent' });
      const result = await (service as any).isDescendant('user-1', 'parent', 'child');
      expect(result).toBe(true);
    });

    it('detects non-descendant', async () => {
      nodeRepo.findOne.mockResolvedValue({ id: 'a', parentId: 'root-a' });
      const result = await (service as any).isDescendant('user-1', 'parent', 'a');
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  describe('auth()', () => {
    let userRepo: any;
    let jwtService: JwtService;

    const makeUser = (o: any = {}) => ({
      id: 'u-1', username: 'alice', role: 'user', status: UserStatus.ACTIVE,
      passwordHash: '$2b$12$hash', loginAttempts: 0, lockedUntil: null,
      ...o,
    } as User);

    const req = (headers: any = {}) =>
      ({ headers, ip: '127.0.0.1' } as Request);

    beforeEach(async () => {
      userRepo = { findOne: jest.fn(), update: jest.fn().mockResolvedValue({}) };
      const mod: TestingModule = await Test.createTestingModule({
        imports: [JwtModule.register({ secret: 'test-secret' })],
        providers: [
          WebdavService,
          { provide: getRepositoryToken(Node), useValue: { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() } },
          { provide: getRepositoryToken(FileChunk), useValue: { find: jest.fn() } },
          { provide: getRepositoryToken(User), useValue: userRepo },
          { provide: getRepositoryToken(NodeKey), useValue: { findOne: jest.fn() } },
          { provide: StorageService, useValue: mockStorage },
        ],
      }).compile();
      service = mod.get(WebdavService);
      jwtService = mod.get(JwtService);
    });

    it('throws without Authorization header', async () => {
      await expect((service as any).auth(req())).rejects.toThrow(UnauthorizedException);
    });

    it('rejects expired JWT', async () => {
      const token = jwtService.sign({ sub: 'u-1' }, { expiresIn: '1ms' });
      await new Promise(r => setTimeout(r, 10));
      await expect((service as any).auth(req({ authorization: `Bearer ${token}` })))
        .rejects.toThrow(UnauthorizedException);
    });

    it('rejects disabled user (Bearer)', async () => {
      const token = jwtService.sign({ sub: 'u-1' });
      userRepo.findOne.mockResolvedValue(makeUser({ status: UserStatus.DISABLED }));
      await expect((service as any).auth(req({ authorization: `Bearer ${token}` })))
        .rejects.toThrow(UnauthorizedException);
    });

    it('rejects Basic auth with wrong password', async () => {
      const basic = Buffer.from('alice:wrong').toString('base64');
      userRepo.findOne.mockResolvedValue(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect((service as any).auth(req({ authorization: `Basic ${basic}` })))
        .rejects.toThrow(UnauthorizedException);
    });

    it('rejects Basic auth for locked account', async () => {
      const basic = Buffer.from('alice:pass').toString('base64');
      userRepo.findOne.mockResolvedValue(makeUser({
        lockedUntil: new Date(Date.now() + 3600000), // 1 hour in future
      }));
      await expect((service as any).auth(req({ authorization: `Basic ${basic}` })))
        .rejects.toThrow(UnauthorizedException);
    });

    it('increments loginAttempts on Basic auth failure', async () => {
      const basic = Buffer.from('alice:wrong').toString('base64');
      userRepo.findOne.mockResolvedValue(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      try { await (service as any).auth(req({ authorization: `Basic ${basic}` })); } catch {}
      expect(userRepo.update).toHaveBeenCalledWith('u-1', expect.objectContaining({ loginAttempts: 1 }));
    });

    it('accepts valid Basic auth and resets attempts', async () => {
      const basic = Buffer.from('alice:correct').toString('base64');
      userRepo.findOne.mockResolvedValue(makeUser({ loginAttempts: 3 }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const user = await (service as any).auth(req({ authorization: `Basic ${basic}` }));
      expect(user.username).toBe('alice');
      expect(userRepo.update).toHaveBeenCalledWith('u-1', { loginAttempts: 0, lockedUntil: null });
    });

    it('rejects Basic auth with empty username', async () => {
      const basic = Buffer.from(':pass').toString('base64');
      await expect((service as any).auth(req({ authorization: `Basic ${basic}` })))
        .rejects.toThrow(UnauthorizedException);
    });

    it('accepts valid Bearer token', async () => {
      const token = jwtService.sign({ sub: 'u-1' });
      userRepo.findOne.mockResolvedValue(makeUser());
      const user = await (service as any).auth(req({ authorization: `Bearer ${token}` }));
      expect(user).toBeDefined();
    });
  });

  describe('handle() routing', () => {
    it('routes OPTIONS to options handler', () => {
      const res: any = { set: jest.fn(), status: jest.fn().mockReturnValue({ send: jest.fn() }) };
      (service as any).handle({ method: 'OPTIONS', headers: {} } as any, res);
      expect(res.set).toHaveBeenCalledWith('Allow', expect.any(String));
    });
  });

  describe('encodePath', () => {
    it('encodes folder with trailing slash', () => {
      const r = (service as any).encodePath('/root', 'docs', true);
      expect(r.endsWith('/')).toBe(true);
    });

    it('encodes file without trailing slash', () => {
      const r = (service as any).encodePath('/root', 'file.txt', false);
      expect(r.endsWith('/')).toBe(false);
    });
  });
});
