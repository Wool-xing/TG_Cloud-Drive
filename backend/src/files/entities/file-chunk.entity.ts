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

  @ManyToOne(() => Node, n => n.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: Node;
}
