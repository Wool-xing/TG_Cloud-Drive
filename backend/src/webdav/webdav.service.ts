import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Request, Response } from 'express';
import * as xml2js from 'xml2js';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Node, NodeType } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { NodeKey } from '../files/entities/node-key.entity';
import { User } from '../users/entities/user.entity';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class WebdavService {
  private logger = new Logger(WebdavService.name);

  constructor(
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(FileChunk) private chunkRepo: Repository<FileChunk>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(NodeKey) private keyRepo: Repository<NodeKey>,
    private jwtService: JwtService,
    private storage: StorageService,
  ) {}

  private async auth(req: Request): Promise<User> {
    const header = req.headers.authorization;
    if (!header) throw new UnauthorizedException();
    if (header.startsWith('Bearer ')) {
      try {
        const payload = this.jwtService.verify(header.slice(7));
        const user = await this.userRepo.findOne({ where: { id: payload.sub } });
        if (user) return user;
      } catch {}
    }
    if (header.startsWith('Basic ')) {
      const [username, password] = Buffer.from(header.slice(6), 'base64').toString().split(':');
      const user = await this.userRepo.findOne({ where: { username } });
      if (user) {
        const valid = await bcrypt.compare(password, user.passwordHash || '');
        if (valid) return user;
      }
    }
    throw new UnauthorizedException();
  }

  async handle(req: Request, res: Response) {
    try {
      const user = await this.auth(req);
      const method = req.method.toUpperCase();
      const urlPath = decodeURIComponent(req.path.replace(/^\/api\/dav\/?/, '') || '');

      switch (method) {
        case 'OPTIONS': return this.options(req, res);
        case 'PROPFIND': return this.propfind(req, res, user.id, urlPath);
        case 'GET': return this.get(req, res, user.id, urlPath);
        case 'PUT': return this.put(req, res, user.id, urlPath);
        case 'DELETE': return this.del(req, res, user.id, urlPath);
        case 'MOVE': return this.move(req, res, user.id, urlPath);
        case 'MKCOL': return this.mkcol(req, res, user.id, urlPath);
        default:
          res.status(405).set('Allow', 'OPTIONS,PROPFIND,GET,PUT,DELETE,MOVE,MKCOL').send();
      }
    } catch (err: any) {
      if (err instanceof UnauthorizedException) {
        res.set('WWW-Authenticate', 'Basic realm="TG Drive WebDAV", Bearer realm="TG Drive WebDAV"');
        res.status(401).send();
        return;
      }
      this.logger.error(`WebDAV error: ${err.message}`);
      res.status(500).send();
    }
  }

  private options(_req: Request, res: Response) {
    res.set('Allow', 'OPTIONS,PROPFIND,GET,PUT,DELETE,MOVE,MKCOL');
    res.set('DAV', '1,2');
    res.status(200).send();
  }

  private async propfind(_req: Request, res: Response, userId: string, path: string) {
    const folder = await this.resolvePath(userId, path);
    if (!folder || folder.type !== NodeType.FOLDER) {
      return res.status(404).send();
    }
    const children = await this.nodeRepo.find({
      where: { parentId: folder.id, userId, isPrivate: false, deletedAt: IsNull() },
      order: { type: 'ASC', name: 'ASC' },
    });

    const builder = new xml2js.Builder({ headless: true });
    const props = children.map(child => ({
      'd:response': {
        'd:href': { _: this.encodePath(path, child.name, child.type === NodeType.FOLDER) },
        'd:propstat': {
          'd:prop': {
            'd:displayname': { _: child.name },
            'd:getcontentlength': { _: child.type === NodeType.FILE ? String(child.size) : '0' },
            'd:getcontenttype': { _: child.mimeType || (child.type === NodeType.FOLDER ? 'httpd/unix-directory' : 'application/octet-stream') },
            'd:resourcetype': child.type === NodeType.FOLDER ? { 'd:collection': {} } : {},
            'd:getlastmodified': { _: child.updatedAt?.toISOString() || child.createdAt.toISOString() },
          },
          'd:status': { _: 'HTTP/1.1 200 OK' },
        },
      },
    }));

    const xml = builder.buildObject({
      'd:multistatus': {
        $: { 'xmlns:d': 'DAV:' },
        'd:response': [
          {
            'd:href': { _: this.encodePath(path) },
            'd:propstat': {
              'd:prop': {
                'd:displayname': { _: folder.name },
                'd:resourcetype': { 'd:collection': {} },
                'd:getlastmodified': { _: folder.updatedAt?.toISOString() || folder.createdAt.toISOString() },
              },
              'd:status': { _: 'HTTP/1.1 200 OK' },
            },
          },
          ...props,
        ],
      },
    });

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(xml);
  }

  private async get(_req: Request, res: Response, userId: string, path: string) {
    const file = await this.resolveFile(userId, path);
    if (!file || file.type !== NodeType.FILE) return res.status(404).send();

    // E2E-encrypted files (uploaded via web UI) have a NodeKey row; the MEK
    // needed to decrypt them lives only in the browser. WebDAV clients cannot
    // decrypt these — return a clear error instead of streaming ciphertext.
    const key = await this.keyRepo.findOne({ where: { nodeId: file.id } });
    if (key) {
      res.status(415).send('This file is end-to-end encrypted and cannot be accessed via WebDAV. Please use the web interface.');
      return;
    }

    const chunks = await this.chunkRepo.find({ where: { nodeId: file.id }, order: { chunkIndex: 'ASC' } });
    if (!chunks.length) return res.status(404).send();

    res.set({
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
    });

    for (const chunk of chunks) {
      const backend = (chunk.storageBackend || 'telegram') as any;
      const key = backend === 'r2' ? chunk.r2Key! : chunk.tgFileId!;
      const url = await this.storage.getUrl(backend, key);
      const r = await fetch(url);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        res.write(buf);
      }
    }
    res.end();
  }

  private async put(req: Request, res: Response, userId: string, path: string) {
    const segments = path.split('/').filter(Boolean);
    if (!segments.length) return res.status(405).send();
    const filename = segments.pop()!;
    const parentPath = segments.join('/');
    const parent = parentPath ? await this.resolvePath(userId, parentPath) : null;
    if (parent && parent.type !== NodeType.FOLDER) return res.status(409).send();

    // Enforce size limit before buffering (DoS protection — matches multer limit)
    const MAX_WEBDAV_UPLOAD = 25 * 1024 * 1024; // 25MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_WEBDAV_UPLOAD) {
      res.status(413).send('Payload too large');
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_WEBDAV_UPLOAD) {
        res.status(413).send('Payload too large');
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    if (!body.length) return res.status(400).send();

    const mimeType = req.headers['content-type'] || 'application/octet-stream';
    const cleanMime = mimeType.split(';')[0].trim();

    try {
      // Quota check before upload
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (user && Number(user.usedBytes) + body.length > Number(user.quotaBytes)) {
        res.status(507).send('Insufficient storage');
        return;
      }

      // Save node first to get stable ID for R2 key
      const node = await this.nodeRepo.save(
        this.nodeRepo.create({
          userId,
          parentId: parent?.id ?? null,
          name: filename,
          type: NodeType.FILE,
          size: 0, // temp; updated after upload
          mimeType: cleanMime,
          isPrivate: false,
        }),
      );

      const backend = this.storage.getPrimary();
      const r2Key = this.storage.buildR2Key(userId, node.id, 0);
      const result = await this.storage.upload(backend, body, r2Key, cleanMime);

      await this.nodeRepo.update(node.id, { size: body.length });
      await this.chunkRepo.save(
        this.chunkRepo.create({
          nodeId: node.id,
          storageBackend: backend,
          tgFileId: result.providerKey,
          tgMessageId: result.providerMeta ? parseInt(result.providerMeta, 10) : null,
          r2Key,
          r2Etag: result.etag || null,
          chunkIndex: 0,
          size: body.length,
        }),
      );

      await this.userRepo.increment({ id: userId }, 'usedBytes', body.length);
      this.logger.log(`WebDAV PUT: ${filename} (${body.length} bytes) → node ${node.id}`);
      res.status(201).send();
    } catch (err: any) {
      this.logger.error(`WebDAV PUT failed: ${err.message}`);
      res.status(502).send();
    }
  }

  private async del(_req: Request, res: Response, userId: string, path: string) {
    const node = await this.resolveFile(userId, path);
    if (!node) return res.status(404).send();

    const ids = [node.id];
    if (node.type === NodeType.FOLDER) {
      const stack = [node.id];
      while (stack.length) {
        const parentId = stack.pop()!;
        const children = await this.nodeRepo.find({ where: { parentId, userId, isPrivate: false, deletedAt: IsNull() } });
        for (const child of children) {
          ids.push(child.id);
          if (child.type === NodeType.FOLDER) stack.push(child.id);
        }
      }
    }
    await this.nodeRepo.createQueryBuilder().update().set({ deletedAt: new Date() }).where('id IN (:...ids)', { ids }).execute();
    this.logger.log(`WebDAV DELETE: ${node.name} + ${ids.length - 1} children`);
    res.status(204).send();
  }

  private async move(req: Request, res: Response, userId: string, path: string) {
    const dest = String(req.headers.destination || '');
    if (!dest) return res.status(400).send();

    // Parse destination URL — extract path after /api/dav/
    let destPath: string;
    try {
      const url = new URL(dest);
      destPath = decodeURIComponent(url.pathname.replace(/^\/api\/dav\/?/, '') || '');
    } catch {
      destPath = decodeURIComponent(dest.replace(/^\/api\/dav\/?/, '') || '');
    }
    if (!destPath) return res.status(400).send();

    // Parse destination segments
    const destSegments = destPath.split('/').filter(Boolean);
    if (!destSegments.length) return res.status(400).send();
    const newName = destSegments.pop()!;
    const destParentPath = destSegments.join('/');

    const src = await this.resolveTarget(userId, path);
    if (!src) return res.status(404).send();

    // Self-move check
    if (src.name === newName && src.parentId === (destParentPath ? (await this.resolvePath(userId, destParentPath))?.id ?? null : null)) {
      res.status(204).send();
      return;
    }

    // Cycle detection: prevent moving a folder into itself or its descendants
    if (src.type === NodeType.FOLDER && destParentPath) {
      const destParent = await this.resolvePath(userId, destParentPath);
      if (destParent) {
        if (destParent.id === src.id) return res.status(409).send();
        if (await this.isDescendant(userId, src.id, destParent.id)) return res.status(409).send();
      }
    }

    const destParent = destParentPath ? await this.resolvePath(userId, destParentPath) : null;
    if (destParentPath && !destParent) return res.status(409).send();
    const destParentId = destParent?.id ?? null;

    // Check duplicate
    const existing = await this.nodeRepo.findOne({
      where: { parentId: destParentId, name: newName, userId, isPrivate: false, deletedAt: IsNull() },
    });
    const isOverwrite = existing && existing.id !== src.id;
    if (isOverwrite) {
      // Clean up overwritten file's Telegram chunks and quota
      const oldChunks = await this.chunkRepo.find({ where: { nodeId: existing.id } });
      for (const c of oldChunks) {
        if (c.storageBackend === 'r2' && c.r2Key) {
          await this.storage.delete('r2', c.r2Key).catch(() => {});
        } else if (c.tgMessageId) {
          await this.storage.delete('telegram', c.tgFileId, String(c.tgMessageId)).catch(() => {});
        }
      }
      if (existing.type === NodeType.FILE) {
        await this.userRepo.decrement({ id: userId }, 'usedBytes', Number(existing.size));
      }
      await this.nodeRepo.delete(existing.id);
    }

    if (src.parentId === destParentId) {
      await this.nodeRepo.update(src.id, { name: newName });
    } else {
      if (destParentId && src.type !== NodeType.FOLDER) {
        const target = await this.nodeRepo.findOne({ where: { id: destParentId, userId, type: NodeType.FOLDER, isPrivate: false, deletedAt: IsNull() } });
        if (!target) return res.status(409).send();
      }
      await this.nodeRepo.update(src.id, { name: newName, parentId: destParentId });
    }

    this.logger.log(`WebDAV MOVE: ${src.name} → ${newName} (parent ${destParentId ?? 'root'})`);
    res.status(isOverwrite ? 204 : 201).send();
  }

  // Check if targetId is a descendant of ancestorId
  private async isDescendant(userId: string, ancestorId: string, targetId: string): Promise<boolean> {
    const visited = new Set<string>();
    let currentId: string | null = targetId;
    while (currentId) {
      if (currentId === ancestorId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);
      const node = await this.nodeRepo.findOne({ where: { id: currentId, userId }, select: ['parentId'] });
      currentId = node?.parentId ?? null;
    }
    return false;
  }

  private async resolveTarget(userId: string, path: string): Promise<Node | null> {
    const folder = await this.resolvePath(userId, path);
    if (folder) return folder;
    return this.resolveFile(userId, path);
  }

  private async mkcol(_req: Request, res: Response, userId: string, path: string) {
    const segments = path.split('/').filter(Boolean);
    if (!segments.length) return res.status(405).send();
    const name = segments.pop()!;
    const parentPath = segments.join('/');
    const parent = parentPath ? await this.resolvePath(userId, parentPath) : null;
    if (parent && parent.type !== NodeType.FOLDER) return res.status(409).send();

    const exists = await this.nodeRepo.findOne({
      where: { parentId: parent?.id ?? null, name, userId, type: NodeType.FOLDER, isPrivate: false, deletedAt: IsNull() },
    });
    if (exists) return res.status(405).send();

    await this.nodeRepo.save(
      this.nodeRepo.create({ userId, parentId: parent?.id ?? null, name, type: NodeType.FOLDER, isPrivate: false }),
    );
    res.status(201).send();
  }

  private async resolveFile(userId: string, path: string): Promise<Node | null> {
    const segments = path.split('/').filter(Boolean);
    if (!segments.length) return null;
    const filename = segments.pop()!;
    const folderPath = segments.join('/');
    const parent = folderPath ? await this.resolvePath(userId, folderPath) : null;
    if (folderPath && !parent) return null;
    return this.nodeRepo.findOne({
      where: { parentId: parent?.id ?? null, name: filename, userId, isPrivate: false, deletedAt: IsNull() },
    });
  }

  private async resolvePath(userId: string, path: string): Promise<Node | null> {
    if (!path || path === '/') return null;
    const segments = path.split('/').filter(Boolean);
    let parentId: string | null = null;
    let current: Node | null = null;
    for (const seg of segments) {
      current = await this.nodeRepo.findOne({
        where: { parentId, name: seg, userId, type: NodeType.FOLDER, isPrivate: false, deletedAt: IsNull() },
      });
      if (!current) return null;
      parentId = current.id;
    }
    return current;
  }

  private readonly prefix = '/api/dav';

  private encodePath(basePath: string, name?: string, isFolder = false) {
    let p = basePath ? `${this.prefix}/${basePath.replace(/\/+/g, '/')}` : this.prefix;
    if (name) p += (p.endsWith('/') ? '' : '/') + name;
    if (isFolder && name) p += '/';
    return p;
  }
}
