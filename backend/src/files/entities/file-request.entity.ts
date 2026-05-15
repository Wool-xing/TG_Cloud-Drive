import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('file_requests')
export class FileRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  folderId: string;

  @Index({ unique: true })
  @Column()
  token: string;

  @Column({ default: 100 })
  maxFiles: number;

  @Column({ default: 0 })
  uploadCount: number;

  @Column()
  expiresAt: Date;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
