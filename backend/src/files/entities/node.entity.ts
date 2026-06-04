import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany,
  JoinColumn, CreateDateColumn, UpdateDateColumn, Index, ManyToMany, JoinTable,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { FileChunk } from './file-chunk.entity';
import { NodeKey } from './node-key.entity';
import { Tag } from './tag.entity';

export enum NodeType { FILE = 'file', FOLDER = 'folder' }

@Entity('nodes')
export class Node {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Index()
  @Column({ name: 'parent_id', nullable: true })
  parentId: string;

  @Column({ length: 500 })
  name: string;

  @Column({ type: 'enum', enum: NodeType })
  type: NodeType;

  @Column({ type: 'bigint', default: 0 })
  size: number;

  @Column({ name: 'mime_type', nullable: true, length: 200 })
  mimeType: string;

  @Column({ name: 'md5_plain', nullable: true, length: 64 })
  md5Plain: string;

  @Column({ name: 'is_locked', default: false })
  isLocked: boolean;

  @Column({ name: 'lock_hash', nullable: true })
  lockHash: string;

  @Column({ name: 'is_private', default: false })
  isPrivate: boolean;

  @Column({ name: 'is_starred', default: false })
  isStarred: boolean;

  @Column({ name: 'thumbnail_file_id', nullable: true })
  thumbnailFileId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string;

  @Column({ name: 'ocr_text', type: 'text', nullable: true, select: false })
  ocrText: string;

  /** PostgreSQL full-text search vector — auto-populated via trigger */
  @Index('idx_nodes_search', { synchronize: false }) // created via raw SQL
  @Column({ name: 'search_vector', type: 'tsvector', nullable: true, select: false })
  searchVector: any;

  @ManyToOne(() => User, u => u.nodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Node, n => n.children, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Node;

  @OneToMany(() => Node, n => n.parent)
  children: Node[];

  @OneToMany(() => FileChunk, c => c.node)
  chunks: FileChunk[];

  @OneToMany(() => NodeKey, k => k.node)
  keys: NodeKey[];

  @ManyToMany(() => Tag, t => t.nodes)
  @JoinTable({ name: 'node_tags', joinColumn: { name: 'node_id' }, inverseJoinColumn: { name: 'tag_id' } })
  tags: Tag[];
}
