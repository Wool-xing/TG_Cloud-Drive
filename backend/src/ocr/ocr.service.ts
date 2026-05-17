import { Injectable, Logger } from '@nestjs/common';
import { createWorker, Worker } from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
  language: string;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private worker: Worker | null = null;

  /** Image/PDF MIME types that Tesseract can process */
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

  async extractText(imageBuffer: Buffer, mimeType: string): Promise<OcrResult> {
    const worker = await this.getWorker();
    const lang = mimeType === 'application/pdf' ? 'eng' : 'chi_sim+eng';

    this.logger.debug(`OCR extracting text, ${imageBuffer.length} bytes, type=${mimeType}`);

    const start = Date.now();
    const { data } = await worker.recognize(imageBuffer, {});
    const elapsed = Date.now() - start;

    const text = (data.text ?? '').trim();
    const confidence = data.confidence ?? 0;

    this.logger.debug(`OCR done in ${elapsed}ms, ${text.length} chars, confidence=${confidence.toFixed(1)}%`);

    return { text, confidence, language: lang };
  }

  async shutdown() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.logger.log('OCR worker terminated');
    }
  }
}
