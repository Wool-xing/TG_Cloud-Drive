import { OcrService } from './ocr.service';

describe('OcrService', () => {
  const service = new OcrService();

  afterAll(async () => {
    await service.shutdown();
  });

  describe('isSupported', () => {
    it.each([
      ['image/png', true],
      ['image/jpeg', true],
      ['image/jpg', true],
      ['image/bmp', true],
      ['image/tiff', true],
      ['application/pdf', true],
      ['IMAGE/PNG', true],
      ['video/mp4', false],
      ['text/plain', false],
      ['application/zip', false],
      ['', false],
    ])('%p → %p', (mimeType, expected) => {
      expect(service.isSupported(mimeType)).toBe(expected);
    });
  });

  describe('extractText', () => {
    it('processes valid image via Tesseract', async () => {
      // 1x1 PNG — valid image, Tesseract can read it
      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );
      const result = await service.extractText(tinyPng, 'image/png');
      expect(typeof result.text).toBe('string');
      expect(result.method).toBe('tesseract');
    }, 90000);
  });
});
