import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Node, NodeType } from './entities/node.entity';
import { FileChunk } from './entities/file-chunk.entity';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(FileChunk) private chunkRepo: Repository<FileChunk>,
    private storage: StorageService,
  ) {}

  /** Get the raw content of a file node */
  async getNodeContent(userId: string, nodeId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    const node = await this.nodeRepo.findOne({
      where: { id: nodeId, userId, deletedAt: null as any },
    });
    if (!node || node.type !== NodeType.FILE) throw new BadRequestException('文件不存在');
    if (!node.mimeType) throw new BadRequestException('未知文件类型');

    const chunks = await this.chunkRepo.find({ where: { nodeId }, order: { chunkIndex: 'ASC' } });
    if (!chunks.length) throw new BadRequestException('文件无内容');

    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      const backend = (chunk.storageBackend || 'telegram') as any;
      const key = backend === 'r2' ? chunk.r2Key! : chunk.tgFileId!;
      const url = await this.storage.getUrl(backend, key);
      const res = await fetch(url);
      if (res.ok) {
        buffers.push(Buffer.from(await res.arrayBuffer()));
      }
    }
    return {
      buffer: Buffer.concat(buffers),
      mimeType: node.mimeType,
      name: node.name,
    };
  }

  /** Export as PDF (HTML wrapper with print auto-trigger) */
  async exportPdf(userId: string, nodeId: string, htmlContent?: string): Promise<{ buffer: Buffer; filename: string }> {
    const { name, mimeType } = await this.getNodeContent(userId, nodeId);

    // If HTML content provided directly, use it. Otherwise, fetch content from file.
    let html: string;
    if (htmlContent) {
      html = htmlContent;
    } else {
      throw new BadRequestException('PDF 导出需要 HTML 内容。请在编辑器中点击导出。');
    }

    const exportName = name.replace(/\.[^.]+$/, '') + '.pdf';

    // Wrap in print-optimized HTML
    const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${name}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 12pt; line-height: 1.8; color: #333; }
  h1 { font-size: 20pt; margin-bottom: 0.5cm; }
  h2 { font-size: 16pt; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #ddd; padding: 8px; }
  img { max-width: 100%; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
  code { font-family: "Consolas", "Courier New", monospace; font-size: 10pt; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>${html}</body>
</html>`;

    return { buffer: Buffer.from(fullHtml, 'utf-8'), filename: exportName };
  }

  /** Export as Word (.docx) */
  async exportDocx(userId: string, nodeId: string, htmlContent?: string): Promise<{ buffer: Buffer; filename: string }> {
    const { name } = await this.getNodeContent(userId, nodeId);
    const exportName = name.replace(/\.[^.]+$/, '') + '.docx';

    if (!htmlContent) {
      throw new BadRequestException('Word 导出需要 HTML 内容。请在编辑器中点击导出。');
    }

    // Dynamically import html-docx-js (CJS)
    const htmlDocx = require('html-docx-js');
    const docxBuffer = htmlDocx.asBlob(htmlContent) as Buffer;
    return { buffer: docxBuffer, filename: exportName };
  }

  /** Export Markdown as styled HTML for print */
  async exportMarkdown(userId: string, nodeId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { name } = await this.getNodeContent(userId, nodeId);
    const exportName = name.replace(/\.[^.]+$/, '') + '.html';

    // Get raw markdown content
    const { buffer } = await this.getNodeContent(userId, nodeId);
    const md = buffer.toString('utf-8');

    // Convert markdown to HTML using marked
    const { marked } = require('marked');
    const html = marked(md);

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${name}</title>
<style>
  body { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 12pt; line-height: 1.8; color: #333; max-width: 800px; margin: auto; padding: 2cm; }
  h1 { font-size: 20pt; }
  h2 { font-size: 16pt; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #ddd; padding: 8px; }
  img { max-width: 100%; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
  code { font-family: "Consolas", monospace; font-size: 10pt; }
</style>
</head>
<body>${html}</body>
</html>`;

    return { buffer: Buffer.from(fullHtml, 'utf-8'), filename: exportName };
  }
}
