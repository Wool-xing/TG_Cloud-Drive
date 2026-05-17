import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Node, NodeType } from '../files/entities/node.entity';

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
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
    // Only allow collaboration on files, not folders
    if (node.type !== NodeType.FILE) return false;
    // Owner or shared-with check — for now, owner only
    // TODO: extend with shares module integration for multi-user access
    return node.userId === userId;
  }

  async getDocumentInfo(nodeId: string) {
    return this.nodeRepo.findOne({
      where: { id: nodeId },
      select: ['id', 'name', 'mimeType', 'size', 'updatedAt', 'isPrivate'],
    });
  }
}
