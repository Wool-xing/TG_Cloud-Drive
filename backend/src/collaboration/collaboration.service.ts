import { Injectable, Logger, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThanOrEqual, MoreThan } from 'typeorm';
import { Node, NodeType } from '../files/entities/node.entity';
import { Share } from '../shares/entities/share.entity';
import { REDIS_CLIENT } from '../common/redis/redis.module';

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(Share) private shareRepo: Repository<Share>,
    @Inject(REDIS_CLIENT) private redis: any,
  ) {}

  async verifyToken(token: string): Promise<{ userId: string } | null> {
    try {
      const payload = this.jwt.verify(token);
      return { userId: payload.sub ?? payload.userId };
    } catch {
      return null;
    }
  }

  async canAccessDoc(userId: string, nodeId: string): Promise<boolean> {
    const node = await this.nodeRepo.findOne({
      where: { id: nodeId, deletedAt: undefined as any },
      select: ['id', 'userId', 'type'],
    });
    if (!node) return false;
    if (node.type !== NodeType.FILE) return false;

    // Owner always has access
    if (node.userId === userId) return true;

    // Check if document has an active share (any authenticated user with the
    // share token can get the DEK via POST /api/shares/:token/access, so
    // allowing them into the WebSocket room is consistent)
    const now = new Date();
    const activeShare = await this.shareRepo.findOne({
      where: [
        { nodeId, isActive: true, expireAt: IsNull() },
        { nodeId, isActive: true, expireAt: MoreThan(now) },
      ],
      select: ['id'],
    });
    if (activeShare) {
      this.logger.debug(`User ${userId} accessing shared doc ${nodeId}`);
      return true;
    }

    return false;
  }

  async getDocumentInfo(nodeId: string) {
    return this.nodeRepo.findOne({
      where: { id: nodeId },
      select: ['id', 'name', 'mimeType', 'size', 'updatedAt', 'isPrivate'],
    });
  }

  /**
   * Returns active peer count for a document from Redis counter.
   *
   * IMPORTANT: This method performs NO caller-level access check. If a
   * controller ever exposes this to clients, gate it behind canAccessDoc()
   * to prevent information leaks (peer counts, document existence probing).
   */
  async getCollaborators(nodeId: string): Promise<number> {
    // Validate nodeId is a UUID before Redis key interpolation
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
      return 0;
    }
    try {
      const count = await this.redis.get(`collab:peers:${nodeId}`);
      return count ? parseInt(count, 10) : 0;
    } catch (e: any) {
      this.logger.warn(`Failed to read peer count for doc ${nodeId}: ${e.message}`);
      return 0;
    }
  }
}
