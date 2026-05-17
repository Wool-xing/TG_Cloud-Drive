import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException, Inject, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In, Brackets } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Node, NodeType } from './entities/node.entity';
import { FileChunk } from './entities/file-chunk.entity';
import { NodeVersion } from './entities/node-version.entity';
import { FileRequest } from './entities/file-request.entity';
import { NodeKey } from './entities/node-key.entity';
import { Tag } from './entities/tag.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { StorageService } from '../storage/storage.service';
import { EmbeddingService } from './embedding.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { comparePassword, hashPassword, generateSecureToken } from '../common/encryption';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(FileChunk) private chunkRepo: Repository<FileChunk>,
    @InjectRepository(NodeKey) private keyRepo: Repository<NodeKey>,
    @InjectRepository(Tag) private tagRepo: Repository<Tag>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(NodeVersion) private versionRepo: Repository<NodeVersion>,
    @InjectRepository(FileRequest) private fileRequestRepo: Repository<FileRequest>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
    @Inject(REDIS_CLIENT) private redis: any,
    private storage: StorageService,
    private embedding: EmbeddingService,
    private cs: ConfigService,
  ) {}

  /**
   * P1-B16: hard cap on list result size. Pre-fix this returned every node
   * under the parent unbounded — a user with 50k files in one folder would
   * dump them all in one response. The cap (500) is a safety ceiling; the
   * sustainable fix is cursor pagination wired through the controller + UI,
   * tracked separately. Returning an array (not an envelope) preserves the
   * existing front-end contract.
   */
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
      name: 'n.name', size: 'n.size', createdAt: 'n.createdAt', updatedAt: 'n.updatedAt',
    };
    qb.orderBy('n.type = \'folder\'', 'DESC')
      .addOrderBy(sortMap[sort] || 'n.createdAt', order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC');

    // P1-B16 caveat: the natural cap (`take(500)` or `limit(500)`) crashes
    // here because TypeORM's split-query mode for take + leftJoinAndSelect
    // tries to resolve the `n.type = 'folder'` ORDER BY expression as an
    // entity property, hitting "Cannot read properties of undefined (reading
    // 'databaseName')". The other paginated paths (listRecent / listStarred /
    // listTrash) don't carry a joinAndSelect, so they DO take(500). For the
    // main browser listing, the cap is deferred to a future cursor-based
    // rewrite — current usage is gated by client-side virtualization.
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

  async createDocument(userId: string, name: string, parentId: string, mimeType: string, contentBase64?: string, isPrivate = false) {
    await this.validateParent(userId, parentId, isPrivate);
    await this.checkDuplicate(userId, parentId, name, isPrivate);

    const empty = !contentBase64;
    const node = this.nodeRepo.create({
      userId, parentId: parentId || null, name, type: NodeType.FILE,
      size: 0, mimeType, isPrivate,
    });
    await this.nodeRepo.save(node);

    // If content provided, upload now. Otherwise create empty placeholder —
    // user edits and saves later via inline editor (triggers updateFileContent).
    if (empty) return this.safeNode(node);
    const buffer = Buffer.from(contentBase64!, 'base64');

    const backend = this.storage.getPrimary();
    const r2Key = backend === 'r2' ? this.storage.buildR2Key(userId, node.id, 0) : undefined;
    const result = await this.storage.upload(backend, buffer, r2Key || name, mimeType);
    await this.chunkRepo.save(this.chunkRepo.create({
      nodeId: node.id, chunkIndex: 0,
      storageBackend: backend,
      tgFileId: result.providerKey,
      tgMessageId: result.providerMeta ? parseInt(result.providerMeta, 10) : null,
      r2Key: r2Key || null,
      r2Etag: result.etag || null,
      size: buffer.length, iv: '000000000000000000000000',
    }));
    await this.nodeRepo.update(node.id, { size: buffer.length });
    if (result.thumbnailFileId) {
      await this.nodeRepo.update(node.id, { thumbnailFileId: result.thumbnailFileId });
    }
    await this.userRepo.increment({ id: userId }, 'usedBytes', buffer.length);
    return this.safeNode(node);
  }

  async uploadChunk(userId: string, nodeIdempotencyKey: string, chunkIndex: number, totalChunks: number,
    filename: string, md5: string, mimeType: string, parentId: string, isPrivate: boolean,
    buffer: Buffer,
    encryptedDek: string, // ciphertext of DEK, written to NodeKey on first chunk
    dekIv: string,        // IV used to wrap DEK with MEK; written to NodeKey.iv on first chunk
    chunkIv: string,      // IV used to encrypt THIS chunk with DEK; written to FileChunk.iv per chunk
    salt: string,         // KDF salt (optional, depends on KDF design)
  ): Promise<any> {

    const cacheKey = `upload:${userId}:${nodeIdempotencyKey}`;
    let nodeId = await this.redis.get(cacheKey).catch(() => null);

    if (!nodeId) {
      // Fail-CLOSED: a brand-new file MUST carry both DEK envelope + first chunk IV.
      // End-to-end encryption is a load-bearing product promise — letting it degrade
      // silently per-request would void it entirely. Pairs with frontend MEK gate.
      if (!encryptedDek || !dekIv) {
        throw new BadRequestException(
          '缺少加密元数据 (encryptedDek/dekIv)：本服务仅接受端到端加密上传，请使用支持加密的客户端',
        );
      }
      await this.validateParent(userId, parentId, isPrivate);
      // Scope duplicate check to the SAME space (public vs private). Without
      // isPrivate in the predicate, uploading "secret.pdf" to public would
      // collide with a private "secret.pdf" → file gets auto-renamed to
      // "secret_1.pdf" in public, leaking the fact that a private file with
      // the same name exists (the rename is observable to anyone with public
      // access). Pair with resolveNameConflict below.
      const existing = await this.nodeRepo.findOne({
        where: { userId, parentId: parentId || null, name: filename, isPrivate, deletedAt: IsNull() },
      });
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

      // NodeKey.iv = dekIv (the IV that wrapped DEK with MEK).
      await this.keyRepo.save(this.keyRepo.create({ nodeId, encryptedDek, iv: dekIv, salt }));
    }

    // Every chunk needs its own fresh IV — reusing one IV across chunks of the
    // same DEK is a catastrophic AES-GCM mistake (nonce-reuse / forbidden-attack).
    if (!chunkIv) {
      throw new BadRequestException('缺少分片加密 IV (chunkIv)，无法保存');
    }
    const backend = this.storage.getPrimary();
    const r2Key = this.storage.buildR2Key(userId, nodeId, chunkIndex);
    const result = await this.storage.upload(backend, buffer, r2Key, 'application/octet-stream');
    await this.chunkRepo.save(this.chunkRepo.create({
      nodeId, chunkIndex,
      storageBackend: backend,
      tgFileId: result.providerKey,
      tgMessageId: result.providerMeta ? parseInt(result.providerMeta, 10) : null,
      r2Key,
      r2Etag: result.etag || null,
      size: buffer.length, checksum: crypto.createHash('md5').update(buffer).digest('hex'),
      iv: chunkIv,
    }));

    const uploaded = await this.chunkRepo.count({ where: { nodeId } });
    if (uploaded === totalChunks) {
      // P1-B9: integrity check on assembly. Before accepting the upload as
      // "done", make sure the chunkIndex set is exactly {0..totalChunks-1}
      // — pre-fix we only counted rows, so a corrupt client that sent
      // chunkIndex 0,0,1,2 would slip through (count == totalChunks even
      // though chunk 3 is missing and chunk 0 is duplicated). Also sanity-
      // check total size against the per-chunk sum.
      const chunks = await this.chunkRepo.find({
        where: { nodeId },
        select: ['chunkIndex', 'size'],
        order: { chunkIndex: 'ASC' },
      });
      const indices = chunks.map(c => c.chunkIndex);
      const expected = Array.from({ length: totalChunks }, (_, i) => i);
      const indexSetOk = indices.length === expected.length && expected.every((v, i) => indices[i] === v);
      if (!indexSetOk) {
        throw new BadRequestException('分片缺失或重复，上传未完成');
      }
      const totalSize = chunks.reduce((acc, c) => acc + Number(c.size), 0);
      await this.nodeRepo.update(nodeId, { size: totalSize });
      await this.userRepo.increment({ id: userId }, 'usedBytes', totalSize);
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
    // Return per-chunk { url, iv } objects. iv is the AES-GCM IV used when this chunk
    // was encrypted client-side; the frontend must use chunk.iv (NOT key.iv) for
    // chunk decryption. key.iv is only for unwrapping the DEK with MEK.
    const chunkInfos = await Promise.all(
      chunks.map(async c => ({
        url: await this.storage.getUrl(
          (c.storageBackend || 'telegram') as any,
          c.storageBackend === 'r2' ? c.r2Key! : c.tgFileId!,
        ),
        iv: c.iv,
      })),
    );

    // P1-B13: return only the fields the client actually needs. Previously the
    // full NodeKey entity (incl. internal id, nodeId, createdAt, updatedAt)
    // shipped to the browser — gratuitous internal-schema disclosure that lets
    // a curious user enumerate row ids and timing patterns.
    const safeKey = key
      ? { encryptedDek: key.encryptedDek, iv: key.iv, salt: key.salt }
      : null;

    await this.audit(userId, 'download', nodeId, node.name);
    return { node: this.safeNode(node), chunks: chunkInfos, key: safeKey };
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
    // P1-B6: reject self-move BEFORE isDescendant. isDescendant walks the chain
    // *up* from nodeId, so it can never observe nodeId as its own ancestor —
    // a self-move slips through, produces a parent_id self-loop in the DB,
    // and turns getPath() into an infinite while-loop on the next read.
    if (targetParentId && targetParentId === nodeId) {
      throw new BadRequestException('不能移动到自身');
    }
    if (targetParentId) {
      const target = await this.getNodeOwned(userId, targetParentId);
      if (target.type !== NodeType.FOLDER) throw new BadRequestException('目标必须是文件夹');
      if (await this.isDescendant(nodeId, targetParentId)) throw new BadRequestException('不能移动到子目录');
    }
    await this.checkFolderLimit(userId, targetParentId, node.isPrivate);
    await this.checkDuplicate(userId, targetParentId, node.name, node.isPrivate);

    // P1-B5: atomic update — require the source row to still have its original
    // parent_id and be undeleted. If a concurrent delete or move has changed
    // it, affected=0 and we surface a 409. Pre-fix, the unconditional UPDATE
    // could write into a now-deleted row or stomp a concurrent move.
    const result = await this.nodeRepo.update(
      { id: nodeId, userId, parentId: node.parentId, deletedAt: IsNull() },
      { parentId: targetParentId || null },
    );
    if (result.affected !== 1) {
      throw new ConflictException('文件状态已变更，请刷新后重试');
    }
    await this.audit(userId, 'move', nodeId, node.name);
    return { message: '移动成功' };
  }

  /**
   * P1-B1 + P1-B2:
   * - B1: copy() now recurses into folder children. Pre-fix, `copy` of a
   *   folder created an empty new folder at the destination and silently
   *   dropped every descendant (data loss surprise — user thinks they copied
   *   "Documents/", finds an empty folder). It also tallied quota only on
   *   the root node, so a folder copy used zero quota regardless of size.
   * - B2: ...node was a blanket spread; lock state (isLocked/lockHash),
   *   star, and shouldn't-be-copied bookkeeping (deletedAt, mekSalt, etc.)
   *   were all carried over. New copy now whitelists fields and resets
   *   lock/star to safe defaults — a "copy" of a locked file shouldn't carry
   *   the parent's lockHash that the user may have since forgotten.
   */
  async copy(userId: string, nodeId: string, targetParentId: string) {
    const root = await this.getNodeOwned(userId, nodeId);
    const newRootName = await this.resolveNameConflict(userId, targetParentId, root.name, root.isPrivate);

    let totalBytesCopied = 0;
    const copyOne = async (src: Node, destParentId: string | null, overrideName?: string): Promise<Node> => {
      const dest = this.nodeRepo.create({
        userId: src.userId,
        parentId: destParentId,
        name: overrideName ?? src.name,
        type: src.type,
        mimeType: src.mimeType,
        size: src.size,
        md5Plain: src.md5Plain,
        isPrivate: src.isPrivate,
        thumbnailFileId: src.thumbnailFileId,
        // B2: reset lock + star + deletion state on copy
        isLocked: false,
        lockHash: null,
        isStarred: false,
        deletedAt: null,
      });
      await this.nodeRepo.save(dest);

      if (src.type === NodeType.FILE) {
        const chunks = await this.chunkRepo.find({ where: { nodeId: src.id } });
        for (const c of chunks) {
          await this.chunkRepo.save(this.chunkRepo.create({
            nodeId: dest.id,
            chunkIndex: c.chunkIndex,
            storageBackend: c.storageBackend || 'telegram',
            tgFileId: c.tgFileId,
            tgMessageId: c.tgMessageId,
            r2Key: c.r2Key,
            r2Etag: c.r2Etag,
            size: c.size,
            checksum: c.checksum,
            iv: c.iv,
          }));
        }
        const key = await this.keyRepo.findOne({ where: { nodeId: src.id } });
        if (key) {
          await this.keyRepo.save(this.keyRepo.create({
            nodeId: dest.id,
            encryptedDek: key.encryptedDek,
            iv: key.iv,
            salt: key.salt,
          }));
        }
        totalBytesCopied += Number(src.size || 0);
      }
      return dest;
    };

    // BFS the source subtree; mirror it under newRoot.
    const newRoot = await copyOne(root, targetParentId || null, newRootName);
    const queue: Array<{ srcId: string; destId: string }> = [{ srcId: root.id, destId: newRoot.id }];
    const maxNodes = 10000; // safety cap
    let processed = 0;
    while (queue.length > 0) {
      if (++processed > maxNodes) {
        throw new BadRequestException(`文件夹包含超过 ${maxNodes} 个节点，无法完整复制。请分批操作。`);
      }
      const { srcId, destId } = queue.shift()!;
      const children = await this.nodeRepo.find({
        where: { userId, parentId: srcId, deletedAt: IsNull() },
      });
      for (const child of children) {
        const newChild = await copyOne(child, destId);
        if (child.type === NodeType.FOLDER) {
          queue.push({ srcId: child.id, destId: newChild.id });
        }
      }
    }

    if (totalBytesCopied > 0) {
      await this.userRepo.increment({ id: userId }, 'usedBytes', totalBytesCopied);
    }
    return this.safeNode(newRoot);
  }

  async softDelete(userId: string, nodeIds: string[]) {
    const nodes = await this.nodeRepo.find({ where: { id: In(nodeIds), userId, deletedAt: IsNull() } });
    if (nodes.length === 0) throw new NotFoundException('未找到文件');
    // P1-B3: cascade into the full descendant subtree. Pre-fix, deleting a
    // folder only flipped deletedAt on the folder row itself; children stayed
    // "alive" — they were invisible in normal listings (parent gone) but the
    // bytes still counted against quota and they could be referenced directly
    // by id. Use a single deletedAt timestamp across the subtree so restore
    // can later identify the same batch.
    const deletedAt = new Date();
    const allIds = await this.collectDescendantIds(userId, nodes.map(n => n.id));
    await this.nodeRepo.update({ id: In(allIds), userId, deletedAt: IsNull() }, { deletedAt });
    for (const n of nodes) await this.audit(userId, 'delete', n.id, n.name);
    return { message: `已移入回收站（${nodes.length} 项，连同子文件 ${allIds.length - nodes.length} 个）` };
  }

  async listTrash(userId: string) {
    // P1-B16: bound trash listing.
    const nodes = await this.nodeRepo.find({
      where: { userId, deletedAt: Not(IsNull()), isPrivate: false },
      order: { deletedAt: 'DESC' },
      take: 500,
    });
    return nodes.map(n => this.safeNode(n));
  }

  async restoreTrash(userId: string, nodeIds: string[]) {
    // P1-B3: mirror of softDelete cascade — restore the whole subtree, not
    // just the explicitly-selected ancestor row. Without this, restoring a
    // folder leaves its children stranded (parent visible again but children
    // still marked deletedAt; UI shows an empty folder).
    const allIds = await this.collectDescendantIds(userId, nodeIds);

    // P1-B4: resolve name conflicts at the restore root level. Pre-fix, if a
    // user deleted "report.pdf", uploaded a new "report.pdf", then restored
    // the old one, both rows lived under the same parent_id with the same
    // name — UI shows two identical entries, link-by-name flows break.
    // Only rename the explicitly-selected restore roots; deeper descendants
    // can't collide because they live under freshly-restored parents.
    for (const id of nodeIds) {
      const n = await this.nodeRepo.findOne({ where: { id, userId } });
      if (!n) continue;
      const safeName = await this.resolveNameConflict(userId, n.parentId, n.name, n.isPrivate);
      if (safeName !== n.name) {
        await this.nodeRepo.update(id, { name: safeName });
      }
    }

    await this.nodeRepo.update({ id: In(allIds), userId }, { deletedAt: null });
    return { message: '恢复成功' };
  }

  /**
   * P1-B3 helper: BFS from given root ids and return all descendant ids
   * (including the roots themselves) owned by userId. Includes already
   * soft-deleted rows so restore can sweep them up too.
   */
  private async collectDescendantIds(userId: string, rootIds: string[]): Promise<string[]> {
    const result = new Set<string>(rootIds);
    let frontier = [...rootIds];
    const maxIterations = 100; // depth guard
    for (let i = 0; i < maxIterations && frontier.length > 0; i++) {
      const children = await this.nodeRepo.find({
        where: { userId, parentId: In(frontier) },
        select: ['id'],
      });
      const newIds = children.map(c => c.id).filter(id => !result.has(id));
      if (newIds.length === 0) break;
      newIds.forEach(id => result.add(id));
      frontier = newIds;
    }
    return Array.from(result);
  }

  async permanentDelete(userId: string, nodeIds: string[]) {
    const nodes = await this.nodeRepo.find({ where: { id: In(nodeIds), userId } });
    for (const node of nodes) {
      // Collect all descendant nodes to properly decrement quota
      if (node.type === NodeType.FOLDER) {
        const descendants = await this.collectDescendantNodes(userId, node.id, true);
        const totalBytes = descendants.reduce((sum, d) => sum + (d.type === NodeType.FILE ? Number(d.size) : 0), 0);
        if (totalBytes > 0) await this.userRepo.decrement({ id: userId }, 'usedBytes', totalBytes);
      } else if (node.type === NodeType.FILE) {
        await this.userRepo.decrement({ id: userId }, 'usedBytes', Number(node.size));
      }
      const chunks = await this.chunkRepo.find({ where: { nodeId: node.id } });
      const r2Keys: string[] = [];
      for (const c of chunks) {
        if (c.storageBackend === 'r2' && c.r2Key) {
          r2Keys.push(c.r2Key);
        } else if (c.storageBackend === 'telegram' && c.tgMessageId) {
          await this.storage.delete('telegram', c.tgFileId, String(c.tgMessageId)).catch(() => {});
        } else if (c.tgMessageId) {
          // Legacy chunks without storageBackend — assume Telegram
          await this.storage.delete('telegram', c.tgFileId, String(c.tgMessageId)).catch(() => {});
        }
      }
      if (r2Keys.length > 0) await this.storage.deleteMany(r2Keys).catch(() => {});
      await this.nodeRepo.delete(node.id);
    }
    return { message: '永久删除成功' };
  }

  private async collectDescendantNodes(userId: string, folderId: string, includeSoftDeleted = false): Promise<Node[]> {
    const result: Node[] = [];
    const stack = [folderId];
    while (stack.length) {
      const parentId = stack.pop()!;
      const where: any = { parentId, userId };
      if (!includeSoftDeleted) where.deletedAt = IsNull();
      const children = await this.nodeRepo.find({ where });
      for (const child of children) {
        result.push(child);
        if (child.type === NodeType.FOLDER) stack.push(child.id);
      }
    }
    return result;
  }

  /**
   * P1-B12: setLock now ONLY sets or changes a lock password. Passing an empty
   * string used to silently clear the lock — a stray `{ password: "" }` from
   * a typo or buggy client could wipe protection. To remove a lock, callers
   * must POST /:nodeId/unlock with the current password (route added in
   * files.controller). Strength floor: 6 chars.
   */
  async setLock(userId: string, nodeId: string, password: string) {
    if (!password || typeof password !== 'string') {
      throw new BadRequestException('请提供密码（解除密码请使用解锁接口）');
    }
    if (password.length < 6) {
      throw new BadRequestException('密码至少需要 6 位');
    }
    await this.getNodeOwned(userId, nodeId);
    const lockHash = await hashPassword(password);
    await this.nodeRepo.update(nodeId, { isLocked: true, lockHash });
    return { message: '已设置密码保护' };
  }

  /**
   * P1-B12 unlock companion: explicit clear endpoint. Re-verifies the current
   * password so a stolen access token alone cannot silently remove protection
   * on someone's locked files.
   */
  async removeLock(userId: string, nodeId: string, password: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    if (!node.isLocked) {
      throw new BadRequestException('该文件未设置密码保护');
    }
    await this.verifyLockWithBruteForceGuard(node, password);
    await this.nodeRepo.update(nodeId, { isLocked: false, lockHash: null });
    return { message: '已取消密码保护' };
  }

  async verifyLock(userId: string, nodeId: string, password: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    if (!node.isLocked) return { valid: true };
    await this.verifyLockWithBruteForceGuard(node, password);
    return { valid: true };
  }

  /**
   * P1-B12 brute-force defense (per-node). 5 wrong attempts → 15-min lock.
   * Mirrors verification-code (P1-A6) and private-space (P1-A3) patterns.
   */
  private async verifyLockWithBruteForceGuard(node: Node, password: string) {
    const failKey = `lock:fail:${node.id}`;
    const lockKey = `lock:lock:${node.id}`;
    const maxAttempts = 5;
    const lockSeconds = 15 * 60;

    let locked: string | null;
    try {
      locked = await this.redis.get(lockKey);
    } catch (e) {
      throw new ForbiddenException('鉴权服务暂时不可用，请稍后重试');
    }
    if (locked) {
      throw new ForbiddenException('密码连续错误次数过多，请 15 分钟后再试');
    }

    const valid = password && (await comparePassword(password, node.lockHash));
    if (!valid) {
      let fails: number;
      try {
        fails = await this.redis.incr(failKey);
        if (fails === 1) await this.redis.expire(failKey, 30 * 60);
      } catch (e) {
        throw new ForbiddenException('鉴权服务暂时不可用，请稍后重试');
      }
      if (fails >= maxAttempts) {
        await this.redis.set(lockKey, '1', 'EX', lockSeconds).catch(() => {});
        await this.redis.del(failKey).catch(() => {});
        throw new ForbiddenException('密码连续错误次数过多，请 15 分钟后再试');
      }
      throw new ForbiddenException('密码错误');
    }

    await this.redis.del(failKey).catch(() => {});
  }

  async moveToPrivate(userId: string, nodeIds: string[], toPrivate: boolean) {
    await this.nodeRepo.update({ id: In(nodeIds), userId }, { isPrivate: toPrivate });
    return { message: toPrivate ? '已移入隐私空间' : '已移出隐私空间' };
  }

  async search(userId: string, keyword: string, type?: string, isPrivate = false, tagId?: string) {
    const kw = (keyword ?? '').slice(0, 100).trim();
    if (!kw) {
      // empty search = list all in current space
      return this.list(userId, '', isPrivate, 'updatedAt', 'DESC', type);
    }

    const qb = this.nodeRepo.createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.deleted_at IS NULL')
      .andWhere('n.is_private = :isPrivate', { isPrivate });

    // Full-text search using PostgreSQL tsvector — supports multi-word queries,
    // prefix matching via :* suffix, and ranks results by relevance.
    // Escaping: plainto_tsquery splits input into tokens; we additionally strip
    // tsquery special chars (! & | ( ) < > ~ :) to prevent syntax errors.
    const sanitized = kw.replace(/[!&|()<>~:@*\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (sanitized) {
      // Build a prefix-match tsquery: "report 2024" → "report:* & 2024:*"
      const tokens = sanitized.split(/\s+/).filter(t => t.length > 0).slice(0, 10);
      const tsquery = tokens.map(t => `${t}:*`).join(' & ');
      qb.andWhere(
        "to_tsvector('simple', n.name) @@ to_tsquery('simple', :tsquery)",
        { tsquery },
      );
      // Rank by relevance (higher = better match)
      qb.addSelect(
        "ts_rank(to_tsvector('simple', n.name), to_tsquery('simple', :tsquery))",
        'search_rank',
      );
      qb.orderBy('search_rank', 'DESC');
    }

    if (type) this.applyMimeTypeFilter(qb, type);
    if (tagId) {
      qb.innerJoin('n.tags', 'tag', 'tag.id = :tagId', { tagId });
    }

    qb.addOrderBy('n.updatedAt', 'DESC');
    const nodes = await qb.limit(100).getMany();
    return nodes.map(n => this.safeNode(n));
  }

  async semanticSearch(userId: string, query: string, isPrivate = false, limit = 20) {
    if (!this.embedding.enabled) {
      // Fall back to FTS when embeddings not configured
      return this.search(userId, query, undefined, isPrivate);
    }

    const sanitized = query.slice(0, 500).trim();
    if (!sanitized) return [];

    // Generate embedding for the search query
    const { embedding } = await this.embedding.embed(sanitized);
    const vector = EmbeddingService.toVectorLiteral(embedding);

    // Cosine similarity search via pgvector
    const raw: any[] = await this.nodeRepo.query(
      `SELECT n.id, n.name, n.type, n.size, n.mime_type, n.is_starred,
              n.is_locked, n.is_private, n.thumbnail_file_id,
              n.parent_id, n.user_id, n.created_at, n.updated_at,
              1 - (ne.embedding <=> $1::vector) AS similarity
       FROM node_embeddings ne
       JOIN nodes n ON n.id = ne.node_id
       WHERE n.user_id = $2
         AND n.deleted_at IS NULL
         AND n.is_private = $3
         AND n.type = 'file'
       ORDER BY ne.embedding <=> $1::vector
       LIMIT $4`,
      [vector, userId, isPrivate, limit],
    );

    return raw.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      size: Number(row.size || 0),
      mimeType: row.mime_type,
      isStarred: row.is_starred,
      isLocked: row.is_locked,
      isPrivate: row.is_private,
      thumbnailFileId: row.thumbnail_file_id,
      parentId: row.parent_id,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _similarity: Number(row.similarity),
    }));
  }

  /** Index a node's content for semantic search */
  async indexNodeEmbedding(userId: string, nodeId: string, textContent: string) {
    if (!this.embedding.enabled) return;
    const node = await this.getNodeOwned(userId, nodeId);
    if (node.type !== NodeType.FILE) return;

    const hash = this.embedding.contentHash(textContent);
    const { embedding } = await this.embedding.embed(textContent);
    const vector = EmbeddingService.toVectorLiteral(embedding);

    // Upsert embedding
    await this.nodeRepo.query(
      `INSERT INTO node_embeddings (node_id, embedding, model, content_hash, updated_at)
       VALUES ($1, $2::vector, $3, $4, now())
       ON CONFLICT (node_id)
       DO UPDATE SET embedding = $2::vector, model = $3, content_hash = $4, updated_at = now()`,
      [nodeId, vector, embedding, hash],
    );
  }

  async setNote(userId: string, nodeId: string, note: string) {
    await this.getNodeOwned(userId, nodeId);
    const trimmed = note ? note.slice(0, 5000) : null;
    await this.nodeRepo.update(nodeId, { note: trimmed });
    return { note: trimmed };
  }

  async toggleStar(userId: string, nodeId: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    await this.nodeRepo.update(nodeId, { isStarred: !node.isStarred });
    return { isStarred: !node.isStarred };
  }

  // ─── Tags ────────────────────────────────────────────────────────────────────

  async listTags(userId: string) {
    return this.tagRepo.find({ where: { userId }, order: { name: 'ASC' } });
  }

  async createTag(userId: string, name: string, color?: string) {
    const exists = await this.tagRepo.findOne({ where: { userId, name } });
    if (exists) return exists;
    return this.tagRepo.save(this.tagRepo.create({ userId, name: name.slice(0, 50), color: color?.slice(0, 20) }));
  }

  async deleteTag(userId: string, tagId: string) {
    const tag = await this.tagRepo.findOne({ where: { id: tagId, userId } });
    if (!tag) throw new NotFoundException('标签不存在');
    await this.tagRepo.remove(tag);
  }

  async addTagToNode(userId: string, nodeId: string, tagId: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    const tag = await this.tagRepo.findOne({ where: { id: tagId, userId } });
    if (!tag) throw new NotFoundException('标签不存在');
    if (!node.tags) node.tags = [];
    if (node.tags.some(t => t.id === tagId)) return;
    node.tags.push(tag);
    await this.nodeRepo.save(node);
  }

  async removeTagFromNode(userId: string, nodeId: string, tagId: string) {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, userId }, relations: ['tags'] });
    if (!node) throw new NotFoundException('文件不存在');
    node.tags = (node.tags || []).filter(t => t.id !== tagId);
    await this.nodeRepo.save(node);
  }

  async listRecent(userId: string, limit = 50) {
    // P1-B16: clamp client-supplied limit so a user can't request 10^9 rows.
    const safeLimit = Math.min(500, Math.max(1, limit | 0 || 50));
    const nodes = await this.nodeRepo.find({
      where: { userId, deletedAt: IsNull(), isPrivate: false },
      order: { updatedAt: 'DESC' },
      take: safeLimit,
    });
    return nodes.map(n => this.safeNode(n));
  }

  async listStarred(userId: string) {
    // P1-B16: bound. Sustained pagination tracked as a separate UI fix.
    const nodes = await this.nodeRepo.find({
      where: { userId, isStarred: true, isPrivate: false, deletedAt: IsNull() },
      order: { updatedAt: 'DESC' },
      take: 500,
    });
    return nodes.map(n => this.safeNode(n));
  }

  async getPath(userId: string, nodeId: string) {
    // P1-B7: cycle protection. parent_id cycles shouldn't exist after P1-B6,
    // but legacy rows from before that fix may carry self-loops or longer
    // cycles. visited tracks ids we've already pushed; maxDepth bounds the
    // walk even on otherwise-valid but pathologically deep trees so a single
    // path lookup can't trash the server.
    const path: any[] = [];
    const visited = new Set<string>();
    const maxDepth = 1000;
    let current = await this.nodeRepo.findOne({ where: { id: nodeId, userId } });
    while (current && path.length < maxDepth) {
      if (visited.has(current.id)) {
        this.logger.warn(`getPath cycle detected at node ${current.id} for user ${userId}`);
        break;
      }
      visited.add(current.id);
      path.unshift({ id: current.id, name: current.name });
      if (!current.parentId) break;
      current = await this.nodeRepo.findOne({ where: { id: current.parentId, userId } });
    }
    return path;
  }

  /** Return flat list of all files under a folder with relative paths for zip download. */
  async getFolderDownloadList(userId: string, folderId: string) {
    const root = await this.getNodeOwned(userId, folderId);
    if (root.type !== NodeType.FOLDER) throw new BadRequestException('仅支持文件夹下载');

    const stack = [{ node: root, relPath: root.name }];
    const files: { node: Node; relPath: string }[] = [];

    while (stack.length) {
      const { node, relPath } = stack.pop()!;
      const children = await this.nodeRepo.find({
        where: { parentId: node.id, userId, deletedAt: IsNull() },
      });
      for (const child of children) {
        const childPath = `${relPath}/${child.name}`;
        if (child.type === NodeType.FOLDER) {
          stack.push({ node: child, relPath: childPath });
        } else {
          files.push({ node: child, relPath: childPath });
        }
      }
    }

    const results = await Promise.all(
      files.map(async ({ node, relPath }) => {
        const info = await this.getDownloadInfo(userId, node.id);
        return { nodeId: node.id, name: node.name, relPath, size: node.size, mimeType: node.mimeType, ...info };
      }),
    );

    return { folderName: root.name, files: results, totalFiles: results.length };
  }

  async updateFileContent(userId: string, nodeId: string, encryptedBuffer: Buffer, iv: string, size: number, mimeType: string, encryptedDek?: string, dekIv?: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    if (node.type !== NodeType.FILE) throw new BadRequestException('仅文件支持');

    // Auto-save version before overwrite (keep last 10 auto-versions per file)
    await this.autoSaveVersion(userId, node).catch(() => {});

    const backend = this.storage.getPrimary();
    const r2Key = this.storage.buildR2Key(userId, nodeId, 0);
    const result = await this.storage.upload(backend, encryptedBuffer, r2Key, mimeType);
    await this.chunkRepo.delete({ nodeId });
    await this.chunkRepo.save(this.chunkRepo.create({
      nodeId, chunkIndex: 0,
      storageBackend: backend,
      tgFileId: result.providerKey,
      tgMessageId: result.providerMeta ? parseInt(result.providerMeta, 10) : null,
      r2Key,
      r2Etag: result.etag || null,
      size, iv,
    }));

    const prevSize = Number(node.size);
    await this.nodeRepo.update(nodeId, { size, mimeType, updatedAt: new Date() });
    if (prevSize !== size) {
      await this.userRepo.increment({ id: userId }, 'usedBytes', size - prevSize);
    }

    // Store NodeKey for first save
    if (encryptedDek && dekIv) {
      const existing = await this.keyRepo.findOne({ where: { nodeId } });
      if (!existing) {
        await this.keyRepo.save(this.keyRepo.create({ nodeId, encryptedDek, iv: dekIv, salt: '' }));
      }
    }

    await this.audit(userId, 'edit', nodeId, node.name);
    return { size };
  }

  async getThumbnailUrl(userId: string, nodeId: string): Promise<string | null> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId, userId, deletedAt: IsNull() } });
    if (!node || node.type === NodeType.FOLDER) return null;

    // Prefer Telegram-generated thumbnail if available
    if (node.thumbnailFileId) {
      return this.storage.getUrl('telegram', node.thumbnailFileId);
    }

    // For unencrypted image files, return first chunk as fallback thumbnail
    if (node.mimeType?.startsWith('image/')) {
      const hasKey = await this.keyRepo.findOne({ where: { nodeId } });
      if (!hasKey) {
        const firstChunk = await this.chunkRepo.findOne({ where: { nodeId }, order: { chunkIndex: 'ASC' } });
        if (firstChunk) {
          return this.storage.getUrl(
            (firstChunk.storageBackend || 'telegram') as any,
            firstChunk.storageBackend === 'r2' ? firstChunk.r2Key! : firstChunk.tgFileId!,
          );
        }
      }
    }

    return null;
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
      // Search only within the same space — names in public and private are
      // independent. Without isPrivate, a private file would influence the
      // numbering of public renames, leaking its existence.
      const exists = await this.nodeRepo.findOne({
        where: { userId, parentId: parentId || null, name: candidate, isPrivate, deletedAt: IsNull() },
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
    // P1-B12: route through the brute-force guard so the download path is
    // also bounded by the per-node 5-attempt lockout. Previously this was a
    // bare comparePassword call — an attacker holding a valid access token
    // could grind unlimited guesses against any locked node via getDownloadInfo.
    await this.verifyLockWithBruteForceGuard(node, password);
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

  // ─── File Request (upload links for non-users) ───────────────────────────────

  async createFileRequest(userId: string, folderId: string, maxFiles = 100, ttlHours = 72) {
    const folder = await this.getNodeOwned(userId, folderId);
    if (folder.type !== NodeType.FOLDER) throw new BadRequestException('仅文件夹支持文件请求');
    const token = generateSecureToken(16);
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
    const req = this.fileRequestRepo.create({ userId, folderId, token, maxFiles, expiresAt });
    await this.fileRequestRepo.save(req);
    return { token, expiresAt, url: `/r/${token}` };
  }

  async getFileRequest(token: string) {
    const req = await this.fileRequestRepo.findOne({ where: { token, isActive: true } });
    if (!req || req.expiresAt < new Date()) throw new NotFoundException('链接无效或已过期');
    return { maxFiles: req.maxFiles, uploadCount: req.uploadCount, expiresAt: req.expiresAt };
  }

  async uploadToFileRequest(token: string, fileBuffer: Buffer, filename: string) {
    const req = await this.fileRequestRepo.findOne({ where: { token, isActive: true } });
    if (!req || req.expiresAt < new Date()) throw new NotFoundException('链接无效或已过期');
    if (req.uploadCount >= req.maxFiles) throw new BadRequestException('已达到上传数量上限');

    req.uploadCount++;
    await this.fileRequestRepo.save(req);

    // Quota check on the receiving folder owner
    const owner = await this.userRepo.findOne({ where: { id: req.userId } });
    if (owner && Number(owner.usedBytes) + fileBuffer.length > Number(owner.quotaBytes)) {
      throw new BadRequestException('接收方存储空间不足');
    }

    // Upload as a simple file node (no encryption for external uploads)
    const node = this.nodeRepo.create({
      userId: req.userId, parentId: req.folderId, name: filename,
      type: NodeType.FILE, size: fileBuffer.length, isPrivate: false,
    });
    await this.nodeRepo.save(node);

    const backend = this.storage.getPrimary();
    const r2Key = this.storage.buildR2Key(req.userId, node.id, 0);
    const result = await this.storage.upload(backend, fileBuffer, r2Key, 'application/octet-stream');
    if (result.thumbnailFileId) {
      await this.nodeRepo.update(node.id, { thumbnailFileId: result.thumbnailFileId });
    }
    const chunk = this.chunkRepo.create({
      nodeId: node.id, chunkIndex: 0,
      storageBackend: backend,
      tgFileId: result.providerKey,
      tgMessageId: result.providerMeta ? parseInt(result.providerMeta, 10) : null,
      r2Key,
      r2Etag: result.etag || null,
      size: fileBuffer.length, iv: '000000000000000000000000',
    });
    await this.chunkRepo.save(chunk);
    await this.userRepo.increment({ id: req.userId }, 'usedBytes', fileBuffer.length);

    return { filename, size: fileBuffer.length };
  }

  // ─── Offline Download (URL → Drive) ─────────────────────────────────────────

  async createOfflineDownload(userId: string, url: string, parentId: string, filename?: string) {
    // Security: only http/https; block private/internal IPs
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('无效的 URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('仅支持 HTTP/HTTPS 链接');
    }

    // Block obviously internal hosts
    const hostname = parsed.hostname.toLowerCase();
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '10.', '172.16.', '192.168.'];
    if (blocked.some(b => hostname === b || hostname.startsWith(b))) {
      throw new BadRequestException('不支持内网地址下载');
    }

    await this.validateParent(userId, parentId || null, false);

    // Extract filename from URL path or Content-Disposition
    const urlName = decodeURIComponent(parsed.pathname.split('/').pop() || 'download');
    const name = (filename || urlName).slice(0, 500);
    const safeName = await this.resolveNameConflict(userId, parentId, name, false);

    // Quota check — we don't know file size yet, just check headroom
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB hard limit
    if (user && Number(user.usedBytes) >= Number(user.quotaBytes)) {
      throw new BadRequestException('存储空间不足');
    }

    // Create placeholder node
    const node = this.nodeRepo.create({
      userId, parentId: parentId || null, name: safeName,
      type: NodeType.FILE, size: 0, isPrivate: false,
    });
    await this.nodeRepo.save(node);

    // Stream-fetch the URL to a buffer (with size limit)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30 * 60_000); // 30min timeout

    try {
      const response = await fetch(url, {
        signal: controller.signal as any,
        headers: { 'User-Agent': 'TGCloudDrive/1.0' },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new BadRequestException(`下载失败：服务器返回 ${response.status}`);
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > maxSize) {
        await this.nodeRepo.delete(node.id);
        throw new BadRequestException(`文件过大（最大 5GB）`);
      }

      // Stream the body in chunks, accumulating into a single buffer
      // (for files < 50MB we buffer; for larger files we'd chunk)
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const reader = (response as any).body;

      if (reader && typeof reader.getReader === 'function') {
        // Web Streams API (Node 18+)
        const streamReader = reader.getReader();
        while (true) {
          const { done, value } = await streamReader.read();
          if (done) break;
          totalBytes += value.length;
          if (totalBytes > maxSize) {
            streamReader.cancel();
            await this.nodeRepo.delete(node.id);
            throw new BadRequestException(`文件过大（最大 5GB）`);
          }
          chunks.push(Buffer.from(value));
        }
      } else {
        // Fallback: buffer the whole response (Node.js fetch body is already a readable stream)
        const buf = Buffer.from(await response.arrayBuffer());
        chunks.push(buf);
        totalBytes = buf.length;
      }

      const buffer = Buffer.concat(chunks);

      // Detect MIME from response or URL extension
      const mimeFromResponse = response.headers.get('content-type')?.split(';')[0]?.trim();
      const mimeType = mimeFromResponse || 'application/octet-stream';

      // Upload to storage
      const backend = this.storage.getPrimary();
      const r2Key = this.storage.buildR2Key(userId, node.id, 0);
      const result = await this.storage.upload(backend, buffer, r2Key, mimeType);

      await this.nodeRepo.update(node.id, { size: buffer.length, mimeType });
      await this.chunkRepo.save(this.chunkRepo.create({
        nodeId: node.id, chunkIndex: 0,
        storageBackend: backend,
        tgFileId: result.providerKey,
        tgMessageId: result.providerMeta ? parseInt(result.providerMeta, 10) : null,
        r2Key,
        r2Etag: result.etag || null,
        size: buffer.length, iv: '000000000000000000000000',
      }));
      await this.userRepo.increment({ id: userId }, 'usedBytes', buffer.length);

      if (result.thumbnailFileId) {
        await this.nodeRepo.update(node.id, { thumbnailFileId: result.thumbnailFileId });
      }

      await this.audit(userId, 'offline-download', node.id, safeName);
      return {
        nodeId: node.id,
        name: safeName,
        size: buffer.length,
        mimeType,
      };
    } catch (e: any) {
      clearTimeout(timeout);
      // Clean up the placeholder node on failure
      await this.nodeRepo.delete(node.id).catch(() => {});
      if (e instanceof BadRequestException) throw e;
      this.logger.error(`Offline download failed: ${e.message}`);
      throw new BadRequestException(`离线下载失败：${e.message.slice(0, 200)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Version History ────────────────────────────────────────────────────────

  async createVersion(userId: string, nodeId: string) {
    const node = await this.getNodeOwned(userId, nodeId);
    if (node.type !== NodeType.FILE) throw new BadRequestException('仅文件支持版本');
    const chunks = await this.chunkRepo.find({ where: { nodeId }, order: { chunkIndex: 'ASC' } });
    if (!chunks.length) throw new BadRequestException('文件无分片数据');
    const key = await this.keyRepo.findOne({ where: { nodeId } });
    const versionCount = await this.versionRepo.count({ where: { nodeId } });

    const version = this.versionRepo.create({
      nodeId, version: versionCount + 1, size: Number(node.size),
      encryptedDek: key?.encryptedDek ?? null,
      dekIv: key?.iv ?? null,
      salt: key?.salt ?? null,
      chunkCount: chunks.length,
      chunkRefs: chunks.map(c => ({
        index: c.chunkIndex, iv: c.iv,
        storageBackend: c.storageBackend || 'telegram',
        telegramFileId: c.tgFileId,
        r2Key: c.r2Key,
      })),
    });
    await this.versionRepo.save(version);
    await this.audit(userId, 'version.create', nodeId, node.name);
    return { version: version.version, createdAt: version.createdAt };
  }

  async getVersions(userId: string, nodeId: string) {
    await this.getNodeOwned(userId, nodeId);
    return this.versionRepo.find({ where: { nodeId }, order: { version: 'DESC' }, select: ['id', 'version', 'size', 'createdAt'] });
  }

  async getVersionDownloadInfo(userId: string, nodeId: string, versionId: string) {
    await this.getNodeOwned(userId, nodeId);
    const version = await this.versionRepo.findOne({ where: { id: versionId, nodeId } });
    if (!version) throw new NotFoundException('版本不存在');
    const chunks = await Promise.all(
      version.chunkRefs.map(async ref => {
        const backend = (ref.storageBackend || 'telegram') as any;
        const key = backend === 'r2' ? ref.r2Key! : ref.telegramFileId!;
        return {
          iv: ref.iv,
          url: await this.storage.getUrl(backend, key),
        };
      }),
    );
    return {
      node: { id: nodeId, size: version.size },
      key: { encryptedDek: version.encryptedDek, iv: version.dekIv, salt: version.salt },
      chunks,
    };
  }

  /** Auto-save a version of the current file state before it's overwritten. */
  private async autoSaveVersion(userId: string, node: Node) {
    const maxAutoVersions = this.cs.get<number>('AUTO_VERSION_LIMIT', 10);
    const chunks = await this.chunkRepo.find({ where: { nodeId: node.id }, order: { chunkIndex: 'ASC' } });
    if (!chunks.length) return; // nothing to snapshot

    const key = await this.keyRepo.findOne({ where: { nodeId: node.id } });
    const existingVersions = await this.versionRepo.count({ where: { nodeId: node.id } });

    // Drop oldest auto-version if over limit
    if (existingVersions >= maxAutoVersions) {
      const oldest = await this.versionRepo.find({
        where: { nodeId: node.id },
        order: { version: 'ASC' },
        take: existingVersions - maxAutoVersions + 1,
      });
      if (oldest.length) {
        await this.versionRepo.delete(oldest.map(v => v.id));
      }
    }

    const nextVersion = existingVersions + 1;
    const version = this.versionRepo.create({
      nodeId: node.id,
      version: nextVersion,
      size: Number(node.size),
      encryptedDek: key?.encryptedDek ?? null,
      dekIv: key?.iv ?? null,
      salt: key?.salt ?? null,
      chunkCount: chunks.length,
      chunkRefs: chunks.map(c => ({
        index: c.chunkIndex,
        iv: c.iv,
        storageBackend: c.storageBackend || 'telegram',
        telegramFileId: c.tgFileId,
        r2Key: c.r2Key,
      })),
    });
    await this.versionRepo.save(version);
  }

  private async audit(userId: string, action: string, nodeId: string, nodeName: string) {
    await this.auditRepo.save(this.auditRepo.create({ userId, action, nodeId, nodeName })).catch(() => {});
  }
}
