import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum VerificationPurpose {
  REGISTER = 'register',
  LOGIN = 'login',
  RESET_PASSWORD = 'reset_password',
  CHANGE_EMAIL = 'change_email',
  CHANGE_PHONE = 'change_phone',
  CHANGE_PASSWORD = 'change_password',
}

@Entity('verification_codes')
export class VerificationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 200 })
  target: string;

  @Column({ length: 10 })
  code: string;

  @Column({ type: 'enum', enum: VerificationPurpose })
  purpose: VerificationPurpose;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
