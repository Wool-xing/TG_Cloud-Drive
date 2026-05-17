import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

@Entity('note_templates')
export class NoteTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 500, nullable: true })
  description: string;

  @Column({ length: 50 })
  category: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
