import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Node } from './node.entity';

@Entity('file_chunks')
export class FileChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'node_id' })
  nodeId: string;

  @Column({ name: 'chunk_index' })
  chunkIndex: number;

  /** Storage backend for this chunk: 'telegram' or 'r2' */
  @Column({ name: 'storage_backend', default: 'telegram', length: 20 })
  storageBackend: string;

  // ── Telegram fields (legacy + fallback) ──────────────────────────────────

  /** Telegram file_id — legacy primary key, nullable for R2-only chunks */
  @Column({ name: 'tg_file_id', nullable: true })
  tgFileId: string;

  /** Telegram message_id — used for deleteMessage */
  @Column({ name: 'tg_message_id', nullable: true })
  tgMessageId: number;

  // ── R2 / S3 fields ──────────────────────────────────────────────────────

  /** R2 object key: {userId}/{nodeId}/chunk_{index} */
  @Column({ name: 'r2_key', nullable: true, length: 512 })
  r2Key: string;

  /** R2 ETag on upload — used for integrity verification */
  @Column({ name: 'r2_etag', nullable: true, length: 64 })
  r2Etag: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column({ nullable: true, length: 64 })
  checksum: string;

  /**
   * Per-chunk IV (hex, 12 bytes = 24 hex chars for AES-GCM).
   *
   * Each chunk is encrypted with a fresh IV — reusing the same IV across multiple
   * chunks of the same DEK is a catastrophic AES-GCM mistake (forbidden-attack).
   * Nullable because legacy rows created before this field existed have no IV
   * and are unrecoverable; new rows MUST populate it (enforced at write site).
   */
  @Column({ nullable: true, length: 32 })
  iv: string;

  @ManyToOne(() => Node, n => n.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: Node;
}
