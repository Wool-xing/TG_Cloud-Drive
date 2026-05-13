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

  @Column({ name: 'tg_file_id' })
  tgFileId: string;

  @Column({ name: 'tg_message_id', nullable: true })
  tgMessageId: number;

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
