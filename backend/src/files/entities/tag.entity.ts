import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, ManyToMany, Index, CreateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Node } from './node.entity';

@Entity('tags')
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column({ length: 50 })
  name: string;

  @Column({ nullable: true, length: 20 })
  color: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToMany(() => Node, n => n.tags)
  nodes: Node[];
}
