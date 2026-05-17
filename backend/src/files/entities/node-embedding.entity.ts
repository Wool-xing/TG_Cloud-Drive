import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Node } from './node.entity';

@Entity('node_embeddings')
export class NodeEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'node_id' })
  nodeId: string;

  @ManyToOne(() => Node, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: Node;

  @Column({ type: 'text' })
  embedding: string; // stored as pgvector string literal: [0.1,0.2,...]

  @Column({ length: 100, default: 'text-embedding-3-small' })
  model: string;

  @Column({ name: 'content_hash', nullable: true, length: 64 })
  contentHash: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
