import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Node } from '../../files/entities/node.entity';

@Entity('shares')
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'node_id' })
  nodeId: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Index({ unique: true })
  @Column({ length: 64 })
  token: string;

  @Column({ name: 'password_hash', nullable: true })
  passwordHash: string;

  @Column({ name: 'expire_at', type: 'timestamptz', nullable: true })
  expireAt: Date;

  @Column({ name: 'max_downloads', nullable: true })
  maxDownloads: number;

  @Column({ name: 'download_count', default: 0 })
  downloadCount: number;

  @Column({ name: 'share_key_fragment', type: 'text', nullable: true })
  shareKeyFragment: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, u => u.shares, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Node, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: Node;
}
