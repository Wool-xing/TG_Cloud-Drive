import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Node } from './node.entity';

@Entity('node_keys')
export class NodeKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'node_id' })
  nodeId: string;

  @Column({ name: 'encrypted_dek', type: 'text' })
  encryptedDek: string;

  @Column({ length: 64 })
  iv: string;

  @Column({ length: 64 })
  salt: string;

  @ManyToOne(() => Node, n => n.keys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: Node;
}
