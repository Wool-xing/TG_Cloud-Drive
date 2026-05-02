import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException, Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In, Brackets } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Node, NodeType } from './entities/node.entity';
import { FileChunk } from './entities/file-chunk.entity';
import { NodeKey } from './entities/node-key.entity';
import { Tag } from './entities/tag.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { TelegramService } from '../telegram/telegram.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { comparePassword, hashPassword } from '../common/encryption';

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(FileChunk) private chunkRepo: Repository<FileChunk>,
    @InjectRepository(NodeKey) private keyRepo: Repository<NodeKey>,
    @InjectRepository(Tag) private tagRepo: Repository<Tag>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    @Inject(REDIS_CLIENT) private redis: any,
    private telegramService: TelegramService,
    private cs: ConfigService,
  ) {}

  async list(userId: string, parentId: string, isPrivate: boolean, sort: string, order: string, type?: string) {
    const qb = this.nodeRepo.createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.deleted_at IS NULL')
      .andWhere('n.is_private = :isPrivate', { isPrivate });

    if (parentId) {
      qb.andWhere('n.parent_id = :parentId', { parentId });
    } else {
      qb.andWhere('n.parent_id IS NULL');
    }

    if (type) this.applyMimeTypeFilter(qb, type);

    const sortMap: Record<string, string> = {
      name: 'n.name', size: 'n.size', createdAt: 'n.created_at', updatedAt: 'n.updated_at',
    };
    qb.orderBy('n.type = \'folder\'', 'DESC')
      .addOrderBy(sortMap[sort] || 'n.created_at', order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC');

    const nodes = await qb.leftJoinAndSelect('n.tags', 'tags').getMany();
    return nodes.map(n => this.safeNode(n));
  }

  async createFolder(userId: string, name: string, parentId: string, isPrivate: boolean) {
    await this.validateParent(userId, parentId, isPrivate);
    await this.checkFolderLimit(userId, parentId, isPrivate);
    await this.checkDuplicate(userId, parentId, name, isPrivate);

    const folder = this.nodeRepo.create({ userId, parentId: parentId || null, name, type: NodeType.FOLDER, isPrivate });
    await this.nodeRepo.save(folder);
    return this.safeNode(folder);
  }

  async uploadChunk(userId: string, nodeIdempotencyKey: string, chunkIndex: number, totalChunks: number,
    filename: string, md5: string, mimeType: string, parentId: string, isPrivate: boolean,
    buffer: Buffer, encryptedDek: string, iv: string, salt: string): Promise<any> {

    const cacheKey = `upload:${userId}:${nodeIdempotencyKey}`;
    let nodeId = await this.redis.get(cacheKey).catch(() => null);

    if (!nodeId) {
      await this.validateParent(userId, parentId, isPrivate);
      const existing = await this.nodeRepo.findOne({ where: { userId, parentId: parentId || null, name: filename, deletedAt: IsNull() } });
      if (existing) {
        const safeName = await this.resolveNameConflict(userId, parentId, filename, isPrivate);
        filename = safeName;
      }
      const node = this.nodeRepo.create({
        userId, parentId: parentId || null, name: filename, type: NodeType.FILE,
        mimeType, md5Plain: md5, isPrivate,
      });
      await this.nodeRepo.save(node);
      nodeId = node.id;
      await this.redis.set(cacheKey, nodeId, 'EX', 3600).catch(() => {});

      if (encryptedDek) {
        await this.keyRepo.save(this.keyRepo.create({ nodeId, encryptedDek, iv, salt }));
      }
    }

    const tgResult = await this.telegramService.sendDocument(buffer, `chunk_${chunkIndex}`, 'application/octet-stream');
    await this.chunkRepo.save(this.chunkRepo.create({
      nodeId, chunkIndex, tgFileId: tgResult.fileId, tgMessageId: tgResult.messageId,
      size: buffer.length, checksum: crypto.createHash('md5').update(buffer).digest('hex'),
    }));

    const uploaded = await this.chunkRepo.count({ where: { nodeId } });
    if (uploaded === totalChunks) {
      const totalSize = await this.chunkRepo.createQueryBuilder('c')
        .where('c.node_id = :nodeId', { nodeId })
        .select('SUM(c.size)', 'total')
        .getRawOne();
      await this.nodeRepo.update(nodeId, { size: Number(totalSize.total) });
      await this.userRepo.increment({ id: userId }, 'usedBytes', Number(totalSize.total));
      await this.redis.del(cacheKey).catch(() => {});
      await this.audit(userId, 'upload', nodeId, filename);
      return { done: true, nodeId };
    }
    return { done: false, nodeId, uploaded, total: totalChunks };
  }

  async getDownloadInfo(userId: string, nodeId: string, lockPassword?: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    if (node.type === NodeType.FOLDER) throw new BadRequestException('文件夹不支持直接下载');

    await this.checkLock(node, lockPassword);

    const chunks = await this.chunkRepo.find({ where: { nodeId }, order: { chunkIndex: 'ASC' } });
    const key = await this.keyRepo.findOne({ where: { nodeId } });
    const downloadUrls = await Promise.all(
      chunks.map(c => this.telegramService.getFileUrl(c.tgFileId))
    );

    await this.audit(userId, 'download', nodeId, node.name);
    return { node: this.safeNode(node), chunks: downloadUrls, key };
  }

  async rename(userId: string, nodeId: string, newName: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    await this.checkDuplicate(userId, node.parentId, newName, node.isPrivate, nodeId);
    await this.nodeRepo.update(nodeId, { name: newName });
    await this.audit(userId, 'rename', nodeId, newName);
    return { ...this.safeNode(node), name: newName };
  }

  async move(userId: string, nodeId: string, targetParentId: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    if (targetParentId) {
      const target = await this.getNodeOwned(userId, targetParentId);
      if (target.type !== NodeType.FOLDER) throw new BadRequestException('目标必须是文件夹');
      if (await this.isDescendant(nodeId, targetParentId)) throw new BadRequestException('不能移动到子目录');
    }
    await this.checkFolderLimit(userId, targetParentId, node.isPrivate);
    await this.checkDuplicate(userId, targetParentId, node.name, node.isPrivate);
    await this.nodeRepo.update(nodeId, { parentId: targetParentId || null });
    await this.audit(userId, 'move', nodeId, node.name);
    return { message: '移动成功' };
  }

  async copy(userId: string, nodeId: string, targetParentId: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    const newName = await this.resolveNameConflict(userId, targetParentId, node.name, node.isPrivate);
    const newNode = this.nodeRepo.create({
      ...node, id: undefined, parentId: targetParentId || null, name: newName, createdAt: undefined, updatedAt: undefined,
    });
    await this.nodeRepo.save(newNode);

    const chunks = await this.chunkRepo.find({ where: { nodeId } });
    for (const c of chunks) {
      await this.chunkRepo.save(this.chunkRepo.create({ ...c, id: undefined, nodeId: newNode.id }));
    }
    const key = await this.keyRepo.findOne({ where: { nodeId } });
    if (key) await this.keyRepo.save(this.keyRepo.create({ ...key, id: undefined, nodeId: newNode.id }));

    await this.userRepo.increment({ id: userId }, 'usedBytes', Number(node.size));
    return this.safeNode(newNode);
  }

  async softDelete(userId: string, nodeIds: string[]) {
    const nodes = await this.nodeRepo.find({ where: { id: In(nodeIds), userId, deletedAt: IsNull() } });
    if (nodes.length === 0) throw new NotFoundException('未找到文件');
    await this.nodeRepo.update({ id: In(nodeIds), userId }, { deletedAt: new Date() });
    for (const n of nodes) await this.audit(userId, 'delete', n.id, n.name);
    return { message: `已移入回收站（${nodes.length} 项）` };
  }

  async listTrash(userId: string) {
    const nodes = await this.nodeRepo.find({
      where: { userId, deletedAt: Not(IsNull()), isPrivate: false },
      order: { deletedAt: 'DESC' },
    });
    return nodes.map(n => this.safeNode(n));
  }

  async restoreTrash(userId: string, nodeIds: string[]) {
    await this.nodeRepo.update({ id: In(nodeIds), userId }, { deletedAt: null });
    return { message: '恢复成功' };
  }

  async permanentDelete(userId: string, nodeIds: string[]) {
    const nodes = await this.nodeRepo.find({ where: { id: In(nodeIds), userId } });
    for (const node of nodes) {
      const chunks = await this.chunkRepo.find({ where: { nodeId: node.id } });
      for (const c of chunks) {
        if (c.tgMessageId) await this.telegramService.deleteMessage(c.tgMessageId).catch(() => {});
      }
      await this.userRepo.decrement({ id: userId }, 'usedBytes', Number(node.size));
      await this.nodeRepo.delete(node.id);
    }
    return { message: '永久删除成功' };
  }

  async setLock(userId: string, nodeId: string, password: string) {
    await this.getNodeOwned(userId, nodeId);
    const lockHash = password ? await hashPassword(password) : null;
    await this.nodeRepo.update(nodeId, { isLocked: !!password, lockHash });
    return { message: password ? '已设置密码保护' : '已取消密码保护' };
  }

  async verifyLock(userId: string, nodeId: string, password: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    if (!node.isLocked) return { valid: true };
    const valid = await comparePassword(password, node.lockHash);
    if (!valid) throw new ForbiddenException('密码错误');
    return { valid: true };
  }

  async moveToPrivate(userId: string, nodeIds: string[], toPrivate: boolean) {
    await this.nodeRepo.update({ id: In(nodeIds), userId }, { isPrivate: toPrivate });
    return { message: toPrivate ? '已移入隐私空间' : '已移出隐私空间' };
  }

  async search(userId: string, keyword: string, type?: string, isPrivate = false) {
    const qb = this.nodeRepo.createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.deleted_at IS NULL')
      .andWhere('n.is_private = :isPrivate', { isPrivate })
      .andWhere('n.name ILIKE :kw', { kw: `%${keyword}%` });
    if (type) this.applyMimeTypeFilter(qb, type);
    const nodes = await qb.orderBy('n.updated_at', 'DESC').limit(100).getMany();
    return nodes.map(n => this.safeNode(n));
  }

  async toggleStar(userId: string, nodeId: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    await this.nodeRepo.update(nodeId, { isStarred: !node.isStarred });
    return { isStarred: !node.isStarred };
  }

  async listRecent(userId: string, limit = 50) {
    const nodes = await this.nodeRepo.find({
      where: { userId, deletedAt: IsNull(), isPrivate: false },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
    return nodes.map(n => this.safeNode(n));
  }

  async listStarred(userId: string) {
    const nodes = await this.nodeRepo.find({
      where: { userId, isStarred: true, deletedAt: IsNull() },
      order: { updatedAt: 'DESC' },
    });
    return nodes.map(n => this.safeNode(n));
  }

  async getPath(userId: string, nodeId: string) {
    const path: any[] = [];
    let current = await this.nodeRepo.findOne({ where: { id: nodeId, userId } });
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      if (!current.parentId) break;
      current = await this.nodeRepo.findOne({ where: { id: current.parentId, userId } });
    }
    return path;
  }

  private async getNodeOwned(userId: string, nodeId: string): Promise<Node> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, userId, deletedAt: IsNull() } });
    if (!node) throw new NotFoundException('文件不存在');
    return node;
  }

  private async validateParent(userId: string, parentId: string, isPrivate: boolean) {
    if (!parentId) return;
    const parent = await this.nodeRepo.findOne({ where: { id: parentId, userId, type: NodeType.FOLDER, deletedAt: IsNull() } });
    if (!parent) throw new NotFoundException('目标文件夹不存在');
  }

  private async checkFolderLimit(userId: string, parentId: string, isPrivate: boolean) {
    const maxFolders = this.cs.get<number>('MAX_FOLDERS_PER_DIR', 10);
    const count = await this.nodeRepo.count({
      where: { userId, parentId: parentId || null, type: NodeType.FOLDER, deletedAt: IsNull(), isPrivate },
    });
    if (count >= maxFolders) throw new BadRequestException(`每个目录最多创建 ${maxFolders} 个文件夹`);
  }

  private async checkDuplicate(userId: string, parentId: string, name: string, isPrivate: boolean, excludeId?: string) {
    const qb = this.nodeRepo.createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.name = :name', { name })
      .andWhere('n.deleted_at IS NULL')
      .andWhere('n.is_private = :isPrivate', { isPrivate });
    if (parentId) qb.andWhere('n.parent_id = :parentId', { parentId });
    else qb.andWhere('n.parent_id IS NULL');
    if (excludeId) qb.andWhere('n.id != :excludeId', { excludeId });
    const exists = await qb.getOne();
    if (exists) throw new ConflictException('同名文件已存在');
  }

  private async resolveNameConflict(userId: string, parentId: string, name: string, isPrivate: boolean): Promise<string> {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    let i = 1;
    while (true) {
      const exists = await this.nodeRepo.findOne({
        where: { userId, parentId: parentId || null, name: candidate, deletedAt: IsNull() },
      });
      if (!exists) return candidate;
      candidate = `${base}_${i}${ext}`;
      i++;
    }
  }

  private async isDescendant(ancestorId: string, nodeId: string): Promise<boolean> {
    let current = await this.nodeRepo.findOne({ where: { id: nodeId } });
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = await this.nodeRepo.findOne({ where: { id: current.parentId } });
    }
    return false;
  }

  private async checkLock(node: Node, password?: string) {
    if (!node.isLocked) return;
    if (!password) throw new ForbiddenException('此文件已加密，请输入密码');
    const valid = await comparePassword(password, node.lockHash);
    if (!valid) throw new ForbiddenException('密码错误');
  }

  private applyMimeTypeFilter(qb: any, type: string): void {
    if (type === 'document') {
      qb.andWhere(new Brackets(b =>
        b.where("n.mime_type = 'application/pdf'")
          .orWhere("n.mime_type LIKE 'text/%'")
          .orWhere("n.mime_type LIKE '%word%'")
          .orWhere("n.mime_type LIKE '%excel%'")
          .orWhere("n.mime_type LIKE '%spreadsheet%'")
          .orWhere("n.mime_type LIKE '%presentation%'")
          .orWhere("n.mime_type LIKE '%powerpoint%'")
          .orWhere("n.mime_type LIKE '%opendocument%'")
      ));
    } else if (type === 'archive') {
      qb.andWhere(new Brackets(b =>
        b.where("n.mime_type LIKE '%zip%'")
          .orWhere("n.mime_type LIKE '%rar%'")
          .orWhere("n.mime_type LIKE '%tar%'")
          .orWhere("n.mime_type LIKE '%gzip%'")
          .orWhere("n.mime_type LIKE '%.7z%'")
          .orWhere("n.mime_type LIKE '%bzip%'")
          .orWhere("n.mime_type LIKE '%x-compressed%'")
      ));
    } else {
      qb.andWhere('n.mime_type LIKE :mimePrefix', { mimePrefix: `${type}/%` });
    }
  }

  safeNode(node: Node) {
    const { lockHash, ...rest } = node as any;
    return { ...rest, size: Number(rest.size || 0) };
  }

  private async audit(userId: string, action: string, nodeId: string, nodeName: string) {
    await this.auditRepo.save(this.auditRepo.create({ userId, action, nodeId, nodeName })).catch(() => {});
  }
}
