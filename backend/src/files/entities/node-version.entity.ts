import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Node } from './node.entity';

@Entity('node_versions')
export class NodeVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid', { name: 'node_id' })
  nodeId: string;

  @ManyToOne(() => Node, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: Node;

  @Column('int')
  version: number;

  @Column('bigint')
  size: number;

  @Column('text', { nullable: true })
  encryptedDek: string | null;

  @Column('text', { nullable: true })
  dekIv: string | null;

  @Column('text', { nullable: true })
  salt: string | null;

  @Column('int')
  chunkCount: number;

  @Column('jsonb')
  chunkRefs: { index: number; iv: string; telegramFileId: string }[];

  @CreateDateColumn()
  createdAt: Date;
}
