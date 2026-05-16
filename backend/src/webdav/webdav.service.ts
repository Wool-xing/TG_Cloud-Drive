import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Request, Response } from 'express';
import * as xml2js from 'xml2js';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Node, NodeType } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { User } from '../users/entities/user.entity';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class WebdavService {
  private logger = new Logger(WebdavService.name);

  constructor(
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(FileChunk) private chunkRepo: Repository<FileChunk>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private telegram: TelegramService,
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
      where: { parentId: folder.id, userId, deletedAt: IsNull() },
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

    const chunks = await this.chunkRepo.find({ where: { nodeId: file.id }, order: { chunkIndex: 'ASC' } });
    if (!chunks.length) return res.status(404).send();

    // Stream file data from Telegram URLs
    res.set({
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
    });

    for (const chunk of chunks) {
      const url = await this.telegram.getFileUrl(chunk.tgFileId);
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

    // Read raw binary body from request stream
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    if (!body.length) return res.status(400).send();

    const mimeType = req.headers['content-type'] || 'application/octet-stream';
    const cleanMime = mimeType.split(';')[0].trim();

    try {
      const { fileId, messageId } = await this.telegram.sendDocument(body, filename, cleanMime);

      const node = await this.nodeRepo.save(
        this.nodeRepo.create({
          userId,
          parentId: parent?.id ?? null,
          name: filename,
          type: NodeType.FILE,
          size: body.length,
          mimeType: cleanMime,
          isPrivate: false,
        }),
      );

      await this.chunkRepo.save(
        this.chunkRepo.create({ nodeId: node.id, tgFileId: fileId, tgMessageId: messageId, chunkIndex: 0, size: body.length }),
      );

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

    await this.nodeRepo.update(node.id, { deletedAt: new Date() });
    this.logger.log(`WebDAV DELETE: ${node.name} (node ${node.id})`);
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

    const src = await this.resolveTarget(userId, path);
    if (!src) return res.status(404).send();

    // Determine destination parent and new name
    const destSegments = destPath.split('/').filter(Boolean);
    if (!destSegments.length) return res.status(400).send();
    const newName = destSegments.pop()!;
    const destParentPath = destSegments.join('/');
    const destParent = destParentPath ? await this.resolvePath(userId, destParentPath) : null;
    if (destParentPath && !destParent) return res.status(409).send();

    const destParentId = destParent?.id ?? null;

    // Check duplicate
    const existing = await this.nodeRepo.findOne({
      where: { parentId: destParentId, name: newName, userId, deletedAt: IsNull() },
    });
    if (existing && existing.id !== src.id) {
      // Overwrite: delete existing, move src
      await this.nodeRepo.update(existing.id, { deletedAt: new Date() });
    }

    if (src.parentId === destParentId) {
      // Same folder — rename
      await this.nodeRepo.update(src.id, { name: newName });
    } else {
      // Different folder — move
      if (destParentId && src.type !== NodeType.FOLDER) {
        const target = await this.nodeRepo.findOne({ where: { id: destParentId, userId, type: NodeType.FOLDER, deletedAt: IsNull() } });
        if (!target) return res.status(409).send();
      }
      await this.nodeRepo.update(src.id, { name: newName, parentId: destParentId });
    }

    this.logger.log(`WebDAV MOVE: ${src.name} → ${newName} (parent ${destParentId ?? 'root'})`);
    res.status(destPath ? 201 : 204).send();
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
      where: { parentId: parent?.id ?? null, name, userId, type: NodeType.FOLDER, deletedAt: IsNull() },
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
      where: { parentId: parent?.id ?? null, name: filename, userId, deletedAt: IsNull() },
    });
  }

  private async resolvePath(userId: string, path: string): Promise<Node | null> {
    if (!path || path === '/') return null;
    const segments = path.split('/').filter(Boolean);
    let parentId: string | null = null;
    let current: Node | null = null;
    for (const seg of segments) {
      current = await this.nodeRepo.findOne({
        where: { parentId, name: seg, userId, type: NodeType.FOLDER, deletedAt: IsNull() },
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
