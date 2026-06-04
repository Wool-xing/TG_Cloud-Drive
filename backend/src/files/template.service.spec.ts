import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TemplateService } from './template.service';
import { NoteTemplate } from './entities/note-template.entity';

describe('TemplateService', () => {
  let service: TemplateService;
  let repo: any;

  beforeEach(async () => {
    repo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [TemplateService, { provide: getRepositoryToken(NoteTemplate), useValue: repo }],
    }).compile();
    service = module.get(TemplateService);
  });

  describe('list', () => {
    it('returns user + system templates', async () => {
      repo.find.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      const r = await service.list('u1');
      expect(r).toHaveLength(2);
      expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({
        where: [{ isSystem: true }, { userId: 'u1' }],
      }));
    });
  });

  describe('create', () => {
    it('creates a user template', async () => {
      repo.create.mockReturnValue({ name: 'test' });
      repo.save.mockResolvedValue({ id: 'new', name: 'test' });
      const r = await service.create('u1', 'test', 'desc', 'cat', 'content');
      expect(r.id).toBe('new');
    });
  });

  describe('delete', () => {
    it('throws when template not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.delete('u1', 't1')).rejects.toThrow('模板不存在');
    });

    it('prevents deleting system templates', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', isSystem: true, userId: 'system' });
      await expect(service.delete('u1', 't1')).rejects.toThrow('不能删除系统模板');
    });

    it('prevents deleting another user template', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', isSystem: false, userId: 'u2' });
      await expect(service.delete('u1', 't1')).rejects.toThrow('无权操作此模板');
    });

    it('deletes own template', async () => {
      const tmpl = { id: 't1', isSystem: false, userId: 'u1' };
      repo.findOne.mockResolvedValue(tmpl);
      await service.delete('u1', 't1');
      expect(repo.remove).toHaveBeenCalledWith(tmpl);
    });
  });

  describe('getContent', () => {
    it('throws when template not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getContent('u1', 't1')).rejects.toThrow('模板不存在');
    });

    it('allows access to system template by any user', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', isSystem: true, content: 'sys content' });
      const r = await service.getContent('u1', 't1');
      expect(r).toBe('sys content');
    });

    it('returns content for own template', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', isSystem: false, userId: 'u1', content: 'my content' });
      const r = await service.getContent('u1', 't1');
      expect(r).toBe('my content');
    });
  });
});
