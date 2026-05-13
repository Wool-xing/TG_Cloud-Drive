import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  GoneException,
  ConflictException,
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

  /**
   * P1-B17: list view returns a truncated token preview only. The full token
   * grants public access to the share — exposing every owned token in a single
   * /shares/my response gave any access-token holder a complete "skeleton key"
   * to all of a user's active shares. Callers that need the full token (e.g.
   * the "copy link" button) must hit getShareToken() per-share, which is
   * audit-logged.
   */
  async listMyShares(userId: string): Promise<any[]> {
    const shares = await this.shareRepo.find({
      where: { userId, isActive: true },
      relations: ['node'],
      order: { createdAt: 'DESC' },
    });

    return shares.map(s => ({
      id: s.id,
      tokenPreview: this.maskToken(s.token),
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

  /**
   * P1-B17: dedicated endpoint to retrieve the full share token. Audit-logged
   * so we can see who pulled which token and when. Owner-only.
   */
  async getShareToken(userId: string, shareId: string): Promise<{ token: string }> {
    const share = await this.shareRepo.findOne({ where: { id: shareId, userId, isActive: true } });
    if (!share) {
      throw new NotFoundException('分享不存在');
    }
    await this.audit(userId, 'share.token.reveal', share.nodeId, null);
    return { token: share.token };
  }

  private maskToken(token: string): string {
    if (!token || token.length < 12) return '****';
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
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
    // P1-B18: cache stores ONLY non-sensitive summary fields. Previously the
    // full Share entity (incl. passwordHash) was JSON-serialized into Redis —
    // a Redis-only leak would expose every share's bcrypt hash for offline
    // brute-forcing. Caching a summary keeps the perf win for the common
    // metadata-fetch path; password verification falls back to the DB row.
    const cacheKey = `share:token:${token}`;
    type ShareSummary = {
      id: string;
      nodeId: string;
      expireAt: string | null;
      maxDownloads: number | null;
      downloadCount: number;
      hasPassword: boolean;
      shareKeyFragment: string | null;
      createdAt: string;
    };
    let summary: ShareSummary | null = null;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) summary = JSON.parse(cached) as ShareSummary;
    } catch (err) {
      this.logger.warn(`Redis get failed for share token cache: ${err.message}`);
    }

    let share: Share | null = null;

    if (!summary) {
      share = await this.shareRepo.findOne({
        where: { token, isActive: true },
        relations: ['node'],
      });
      if (!share) {
        throw new NotFoundException('分享链接不存在或已失效');
      }
      summary = {
        id: share.id,
        nodeId: share.nodeId,
        expireAt: share.expireAt ? share.expireAt.toISOString() : null,
        maxDownloads: share.maxDownloads,
        downloadCount: share.downloadCount,
        hasPassword: !!share.passwordHash,
        shareKeyFragment: share.shareKeyFragment,
        createdAt: share.createdAt.toISOString(),
      };
      try {
        await this.redis.setex(cacheKey, SHARE_CACHE_TTL, JSON.stringify(summary));
      } catch (err) {
        this.logger.warn(`Redis setex failed for share token: ${err.message}`);
      }
    }

    // Validate expiry (from summary — no DB hit needed)
    if (summary.expireAt && new Date(summary.expireAt) < new Date()) {
      this.shareRepo.update(summary.id, { isActive: false }).catch(() => {});
      await this.invalidateCache(token);
      throw new GoneException('分享链接已过期');
    }

    // Validate download count (advisory check — authoritative enforcement is
    // the CAS UPDATE in incrementDownload, P1-B19)
    if (summary.maxDownloads !== null && summary.downloadCount >= summary.maxDownloads) {
      throw new GoneException('下载次数已达上限');
    }

    // Password verification: load hash from DB only when needed.
    if (summary.hasPassword) {
      if (!password) {
        throw new UnauthorizedException('此分享需要密码');
      }
      const row = share ?? await this.shareRepo.findOne({ where: { id: summary.id, isActive: true } });
      if (!row || !row.passwordHash) {
        // Race: share was deactivated or password cleared between cache write
        // and this read. Invalidate and refuse rather than treating as no-password.
        await this.invalidateCache(token);
        throw new UnauthorizedException('分享密码错误');
      }
      const valid = await comparePassword(password, row.passwordHash);
      if (!valid) {
        throw new UnauthorizedException('分享密码错误');
      }
    }

    // Resolve node for response payload
    const node = await this.nodeRepo.findOne({ where: { id: summary.nodeId, deletedAt: IsNull() } });
    if (!node) {
      throw new GoneException('文件已被删除');
    }

    return {
      shareId: summary.id,
      nodeId: summary.nodeId,
      nodeName: node.name,
      nodeType: node.type,
      nodeSize: Number(node.size),
      nodeMimeType: node.mimeType,
      thumbnailFileId: node.thumbnailFileId,
      shareKeyFragment: summary.shareKeyFragment,
      hasPassword: summary.hasPassword,
      expireAt: summary.expireAt,
      maxDownloads: summary.maxDownloads,
      downloadCount: summary.downloadCount,
      createdAt: summary.createdAt,
    };
  }

  // ─── Increment download count ───────────────────────────────────────────────

  /**
   * P1-B19: atomic conditional increment. Pre-fix this was a non-atomic
   * `increment` after a separate `accessShare` check — N concurrent downloaders
   * of a maxDownloads=1 share would all pass the check, all increment, and all
   * receive the file. The CAS UPDATE here only increments while still under
   * the cap, and throws GoneException when affected=0 (cap already reached).
   * Pair this with the controller's recordDownload, which calls
   * accessShare() first and then this — the only authoritative cap enforcement
   * lives in the WHERE clause below.
   */
  async incrementDownload(shareId: string): Promise<void> {
    const result = await this.shareRepo
      .createQueryBuilder()
      .update(Share)
      .set({ downloadCount: () => 'download_count + 1' })
      .where('id = :id', { id: shareId })
      .andWhere('(max_downloads IS NULL OR download_count < max_downloads)')
      .execute();

    if (result.affected !== 1) {
      // Loser of the race: cap already reached. Surface the same error the
      // accessShare advisory check would return.
      throw new GoneException('下载次数已达上限');
    }

    const share = await this.shareRepo.findOne({ where: { id: shareId } });
    if (share) {
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
