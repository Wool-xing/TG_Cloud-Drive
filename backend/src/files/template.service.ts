import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { NoteTemplate } from './entities/note-template.entity';

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(NoteTemplate) private templateRepo: Repository<NoteTemplate>,
  ) {}

  async list(userId: string) {
    return this.templateRepo.find({
      where: [{ isSystem: true }, { userId }],
      order: { isSystem: 'DESC', createdAt: 'ASC' },
    });
  }

  async create(
    userId: string,
    name: string,
    description: string,
    category: string,
    content: string,
  ) {
    return this.templateRepo.save(
      this.templateRepo.create({ userId, name, description, category, content, isSystem: false }),
    );
  }

  async delete(userId: string, templateId: string) {
    const tmpl = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!tmpl) throw new NotFoundException('模板不存在');
    if (tmpl.isSystem) throw new ForbiddenException('不能删除系统模板');
    if (tmpl.userId !== userId) throw new ForbiddenException('无权操作此模板');
    await this.templateRepo.remove(tmpl);
  }

  async getContent(userId: string, templateId: string): Promise<string> {
    const tmpl = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!tmpl) throw new NotFoundException('模板不存在');
    if (!tmpl.isSystem && tmpl.userId !== userId) throw new ForbiddenException('无权访问此模板');
    return tmpl.content;
  }
}
