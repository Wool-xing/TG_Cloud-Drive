import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'EMBEDDING_API_KEY') return '';
        if (key === 'EMBEDDING_API_BASE') return 'https://api.openai.com/v1';
        if (key === 'EMBEDDING_MODEL') return 'text-embedding-3-small';
        return null;
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmbeddingService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();
    service = module.get(EmbeddingService);
  });

  describe('enabled', () => {
    it('returns false when no API key configured', () => {
      expect(service.enabled).toBe(false);
    });
  });

  describe('contentHash', () => {
    it('produces consistent SHA-256 hash', () => {
      const h1 = service.contentHash('hello world');
      const h2 = service.contentHash('hello world');
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64);
    });

    it('truncates input to 8000 chars', () => {
      const long = 'a'.repeat(10000);
      const short = 'a'.repeat(8000);
      expect(service.contentHash(long)).toBe(service.contentHash(short));
    });

    it('produces different hashes for different content', () => {
      const h1 = service.contentHash('foo');
      const h2 = service.contentHash('bar');
      expect(h1).not.toBe(h2);
    });
  });

  describe('toVectorLiteral', () => {
    it('formats embedding array as pgvector literal', () => {
      expect(EmbeddingService.toVectorLiteral([1, 2, 3])).toBe('[1,2,3]');
    });

    it('handles floating point values', () => {
      expect(EmbeddingService.toVectorLiteral([0.1, 0.2])).toBe('[0.1,0.2]');
    });

    it('returns empty brackets for empty array', () => {
      expect(EmbeddingService.toVectorLiteral([])).toBe('[]');
    });
  });

  describe('embed', () => {
    it('throws when API key not configured', async () => {
      await expect(service.embed('test text')).rejects.toThrow('EMBEDDING_API_KEY not configured');
    });
  });
});
