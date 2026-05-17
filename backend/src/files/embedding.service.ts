import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private apiKey: string;
  private apiBase: string;
  private model: string;

  constructor(private cs: ConfigService) {
    this.apiKey = cs.get<string>('EMBEDDING_API_KEY') || '';
    this.apiBase = cs.get<string>('EMBEDDING_API_BASE') || 'https://api.openai.com/v1';
    this.model = cs.get<string>('EMBEDDING_MODEL') || 'text-embedding-3-small';
  }

  get enabled(): boolean {
    return !!this.apiKey;
  }

  /** Generate embedding vector for text content */
  async embed(text: string): Promise<EmbeddingResult> {
    if (!this.apiKey) throw new Error('EMBEDDING_API_KEY not configured');

    const truncated = text.slice(0, 8000); // OpenAI token limit safety
    const key = crypto.createHash('sha256').update(truncated).digest('hex');

    try {
      const res = await fetch(`${this.apiBase}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: truncated }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${body.slice(0, 200)}`);
      }

      const json = await res.json() as any;
      const embedding = json.data?.[0]?.embedding;
      if (!embedding) throw new Error('No embedding in response');

      return { embedding, model: this.model };
    } catch (e: any) {
      this.logger.error(`Embedding generation failed: ${e.message}`);
      throw e;
    }
  }

  /** Hash text content for cache validation */
  contentHash(text: string): string {
    return crypto.createHash('sha256').update(text.slice(0, 8000)).digest('hex');
  }

  /** Convert embedding number array to pgvector literal string */
  static toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
