import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  GoneException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Share } from './entities/share.entity';
import { Node } from '../files/entities/node.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { comparePassword, hashPassword, generateSecureToken } from '../common/encryption';

export interface CreateShareDto {
  nodeId: string;
  password?: string;
  expireAt?: string; // ISO date string, optional
  maxDownloads?: number;
  shareKeyFragment?: string;
}

const SHARE_CACHE_TTL = 60; // seconds

@Injectable()
export class SharesService {
  private readonly logger = new Logger(SharesService.name);

  constructor(
    @InjectRepository(Share) private shareRepo: Repository<Share>,
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    @Inject(REDIS_CLIENT) private redis: any,
    private cs: ConfigService,
  ) {}

  // ─── Create ────────────────────────────────────────────────────────────────

  async createShare(userId: string, dto: CreateShareDto): Promise<Share> {
    const { nodeId, password, expireAt, maxDownloads, shareKeyFragment } = dto;

    // Verify the node exists and belongs to this user
    const node = await this.nodeRepo.findOne({
      where: { id: nodeId, userId, deletedAt: IsNull() },
    });
    if (!node) {
      throw new NotFoundException('文件或文件夹不存在');
    }

    // Deactivate any existing active share for the same node by this user
    await this.shareRepo.update(
      { nodeId, userId, isActive: true },
      { isActive: false },
    );

    const token = generateSecureToken(32); // 64 hex chars
    const passwordHash = password ? await hashPassword(password) : null;

    const share = this.shareRepo.create({
      nodeId,
      userId,
      token,
      passwordHash,
      expireAt: expireAt ? new Date(expireAt) : null,
      maxDownloads: maxDownloads || null,
      downloadCount: 0,
      shareKeyFragment: shareKeyFragment || null,
      isActive: true,
    });

    await this.shareRepo.save(share);
    await this.audit(userId, 'share.create', nodeId, node.name);

    return this.safeShare(share);
  }

  // ─── List my shares ─────────────────────────────────────────────────────────

  async listMyShares(userId: string): Promise<any[]> {
    const shares = await this.shareRepo.find({
      where: { userId, isActive: true },
      relations: ['node'],
      order: { createdAt: 'DESC' },
    });

    return shares.map(s => ({
      id: s.id,
      token: s.token,
      nodeId: s.nodeId,
      nodeName: s.node?.name ?? null,
      nodeType: s.node?.type ?? null,
      nodeSize: s.node ? Number(s.node.size) : null,
      hasPassword: !!s.passwordHash,
      expireAt: s.expireAt,
      maxDownloads: s.maxDownloads,
      downloadCount: s.downloadCount,
      createdAt: s.createdAt,
    }));
  }

  // ─── Delete / Deactivate ────────────────────────────────────────────────────

  async deleteShare(userId: string, shareId: string): Promise<{ message: string }> {
    const share = await this.shareRepo.findOne({
      where: { id: shareId, userId },
    });
    if (!share) {
      throw new NotFoundException('分享不存在');
    }
    if (share.userId !== userId) {
      throw new ForbiddenException('无权操作此分享');
    }

    share.isActive = false;
    await this.shareRepo.save(share);

    // Invalidate Redis cache
    await this.invalidateCache(share.token);
    await this.audit(userId, 'share.delete', share.nodeId, null);

    return { message: '分享已关闭' };
  }

  // ─── Public Access ──────────────────────────────────────────────────────────

  async accessShare(token: string, password?: string): Promise<any> {
    // Try cache first
    const cacheKey = `share:token:${token}`;
    let share: Share | null = null;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        share = JSON.parse(cached) as Share;
        // Re-hydrate date objects from JSON
        if (share.expireAt) share.expireAt = new Date(share.expireAt);
        if (share.createdAt) share.createdAt = new Date(share.createdAt);
      }
    } catch (err) {
      this.logger.warn(`Redis get failed for share token cache: ${err.message}`);
    }

    if (!share) {
      share = await this.shareRepo.findOne({
        where: { token, isActive: true },
        relations: ['node'],
      });

      if (!share) {
        throw new NotFoundException('分享链接不存在或已失效');
      }

      // Cache it (exclude sensitive passwordHash)
      try {
        await this.redis.setex(cacheKey, SHARE_CACHE_TTL, JSON.stringify(share));
      } catch (err) {
        this.logger.warn(`Redis setex failed for share token: ${err.message}`);
      }
    } else {
      // Cache hit – reload node relation if not present
      if (!share.node) {
        const node = await this.nodeRepo.findOne({ where: { id: share.nodeId, deletedAt: IsNull() } });
        share.node = node;
      }
    }

    // Validate expiry
    if (share.expireAt && new Date(share.expireAt) < new Date()) {
      // Deactivate in background
      this.shareRepo.update(share.id, { isActive: false }).catch(() => {});
      await this.invalidateCache(token);
      throw new GoneException('分享链接已过期');
    }

    // Validate download count
    if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
      throw new GoneException('下载次数已达上限');
    }

    // Validate password
    if (share.passwordHash) {
      if (!password) {
        throw new UnauthorizedException('此分享需要密码');
      }
      const valid = await comparePassword(password, share.passwordHash);
      if (!valid) {
        throw new UnauthorizedException('分享密码错误');
      }
    }

    // Verify the underlying node still exists
    const node = share.node ?? await this.nodeRepo.findOne({ where: { id: share.nodeId, deletedAt: IsNull() } });
    if (!node) {
      throw new GoneException('文件已被删除');
    }

    return {
      shareId: share.id,
      nodeId: share.nodeId,
      nodeName: node.name,
      nodeType: node.type,
      nodeSize: Number(node.size),
      nodeMimeType: node.mimeType,
      thumbnailFileId: node.thumbnailFileId,
      shareKeyFragment: share.shareKeyFragment,
      hasPassword: !!share.passwordHash,
      expireAt: share.expireAt,
      maxDownloads: share.maxDownloads,
      downloadCount: share.downloadCount,
      createdAt: share.createdAt,
    };
  }

  // ─── Increment download count ───────────────────────────────────────────────

  async incrementDownload(shareId: string): Promise<void> {
    await this.shareRepo.increment({ id: shareId }, 'downloadCount', 1);

    // Fetch the updated share to check if we should invalidate cache
    const share = await this.shareRepo.findOne({ where: { id: shareId } });
    if (share) {
      // Invalidate so next access picks fresh download count
      await this.invalidateCache(share.token);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async invalidateCache(token: string): Promise<void> {
    try {
      await this.redis.del(`share:token:${token}`);
    } catch (err) {
      this.logger.warn(`Redis del failed: ${err.message}`);
    }
  }

  private safeShare(share: Share): any {
    return {
      id: share.id,
      token: share.token,
      nodeId: share.nodeId,
      hasPassword: !!share.passwordHash,
      expireAt: share.expireAt,
      maxDownloads: share.maxDownloads,
      downloadCount: share.downloadCount,
      shareKeyFragment: share.shareKeyFragment,
      isActive: share.isActive,
      createdAt: share.createdAt,
    };
  }

  private async audit(
    userId: string,
    action: string,
    nodeId: string | null,
    nodeName: string | null,
  ): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({ userId, action, nodeId, nodeName }),
      );
    } catch (err) {
      this.logger.warn(`Audit log failed: ${err.message}`);
    }
  }
}
