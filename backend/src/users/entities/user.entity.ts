import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, OneToMany, Index,
} from 'typeorm';
import { Node } from '../../files/entities/node.entity';
import { Share } from '../../shares/entities/share.entity';
import { AuditLog } from './audit-log.entity';
import { Device } from './device.entity';

export enum UserRole { USER = 'user', ADMIN = 'admin' }
export enum UserStatus { ACTIVE = 'active', DISABLED = 'disabled' }

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 50 })
  username: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'email_encrypted', nullable: true })
  emailEncrypted: string;

  /**
   * Deterministic HMAC of the normalized email — indexable, server-bound,
   * not reversible. See common/encryption.ts hashIdentifier(). Allows O(1)
   * login-by-email + unique-email-per-user enforcement, without storing
   * plaintext emails. NULL allowed (PG: multiple NULLs satisfy UNIQUE).
   */
  @Index({ unique: true })
  @Column({ name: 'email_hash', nullable: true, length: 64 })
  emailHash: string;

  @Column({ name: 'phone_encrypted', nullable: true })
  phoneEncrypted: string;

  /** Same construction as emailHash, for phone numbers. */
  @Index({ unique: true })
  @Column({ name: 'phone_hash', nullable: true, length: 64 })
  phoneHash: string;

  @Column({ nullable: true, length: 255 })
  nickname: string;

  @Column({ nullable: true, length: 500 })
  avatar: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ name: 'quota_bytes', type: 'bigint', default: 53687091200 }) // 50GB
  quotaBytes: number;

  @Column({ name: 'used_bytes', type: 'bigint', default: 0 })
  usedBytes: number;

  @Column({ name: 'mek_salt', nullable: true })
  mekSalt: string;

  @Column({ name: 'private_space_hash', nullable: true })
  privateSpaceHash: string;

  @Column({ name: 'login_attempts', default: 0 })
  loginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date;

  @Column({ name: 'notify_share_access', default: true })
  notifyShareAccess: boolean;

  @Column({ name: 'notify_foreign_login', default: true })
  notifyForeignLogin: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Node, n => n.user)
  nodes: Node[];

  @OneToMany(() => Share, s => s.user)
  shares: Share[];

  @OneToMany(() => AuditLog, l => l.user)
  auditLogs: AuditLog[];

  @OneToMany(() => Device, d => d.user)
  devices: Device[];
}
