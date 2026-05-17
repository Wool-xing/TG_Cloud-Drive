import { Injectable, Logger } from '@nestjs/common';
import { createWorker, Worker } from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
  language: string;
  method: 'tesseract' | 'pdf-parse' | 'none';
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private worker: Worker | null = null;

  private static readonly SUPPORTED_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/bmp',
    'image/tiff',
    'application/pdf',
  ];

  private async getWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = await createWorker('chi_sim+eng');
      this.logger.log('OCR worker initialized (chi_sim+eng)');
    }
    return this.worker;
  }

  isSupported(mimeType: string): boolean {
    return OcrService.SUPPORTED_TYPES.includes(mimeType?.toLowerCase());
  }

  async extractText(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    const start = Date.now();
    this.logger.debug(`OCR extracting, ${buffer.length} bytes, type=${mimeType}`);

    // PDF: try pdf-parse first (fast, works for text-based PDFs)
    if (mimeType === 'application/pdf') {
      return this.extractPdf(buffer);
    }

    // Images: use Tesseract directly
    const worker = await this.getWorker();
    const { data } = await worker.recognize(buffer, {});
    const elapsed = Date.now() - start;

    const text = (data.text ?? '').trim();
    const confidence = data.confidence ?? 0;

    this.logger.debug(`OCR (tesseract) done in ${elapsed}ms, ${text.length} chars, confidence=${confidence.toFixed(1)}%`);
    return { text, confidence, language: 'chi_sim+eng', method: 'tesseract' };
  }

  private async extractPdf(buffer: Buffer): Promise<OcrResult> {
    const start = Date.now();

    // Step 1: try pdf-parse for native text extraction
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      const text = (data.text ?? '').trim();

      if (text.length >= 20) {
        const elapsed = Date.now() - start;
        this.logger.debug(`PDF text extracted (pdf-parse) in ${elapsed}ms, ${text.length} chars`);
        return { text, confidence: 95, language: 'auto', method: 'pdf-parse' };
      }
    } catch (err: any) {
      this.logger.debug(`pdf-parse failed: ${err.message}, falling back to OCR`);
    }

    // Step 2: fall back to Tesseract OCR for image-based/scanned PDFs
    try {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(buffer);
      const elapsed = Date.now() - start;
      const text = (data.text ?? '').trim();
      this.logger.debug(`PDF OCR (tesseract) done in ${elapsed}ms, ${text.length} chars, confidence=${(data.confidence ?? 0).toFixed(1)}%`);
      return { text, confidence: data.confidence ?? 0, language: 'eng', method: 'tesseract' };
    } catch (err: any) {
      this.logger.warn(`PDF OCR failed: ${err.message}`);
      return { text: '', confidence: 0, language: 'none', method: 'none' };
    }
  }

  async shutdown() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.logger.log('OCR worker terminated');
    }
  }
}
