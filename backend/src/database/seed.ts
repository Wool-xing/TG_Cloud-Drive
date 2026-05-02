/**
 * Database seeder — run once after first migration to create the admin user.
 * Usage: npx ts-node src/database/seed.ts
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { Device } from '../users/entities/device.entity';
import { AuditLog } from '../users/entities/audit-log.entity';
import { Node } from '../files/entities/node.entity';
import { FileChunk } from '../files/entities/file-chunk.entity';
import { NodeKey } from '../files/entities/node-key.entity';
import { Tag } from '../files/entities/tag.entity';
import { Share } from '../shares/entities/share.entity';
import { VerificationCode } from '../verification/verification.entity';
import { hashPassword, generateSalt, encryptField } from '../common/encryption';

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [User, Device, AuditLog, Node, FileChunk, NodeKey, Tag, Share, VerificationCode],
    synchronize: true,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await ds.initialize();

  const repo = ds.getRepository(User);
  const existing = await repo.findOne({ where: { username: 'Wool' } });
  if (existing) {
    console.log('Admin user already exists, skipping seed.');
    await ds.destroy();
    return;
  }

  const password = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@123456';
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  const phone = '19247050520';

  const admin = repo.create({
    username: 'Wool',
    passwordHash: await hashPassword(password),
    mekSalt: generateSalt(),
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    quotaBytes: 1099511627776, // 1TB for admin
    phoneEncrypted: masterKey ? encryptField(phone, masterKey) : null,
  });

  await repo.save(admin);
  console.log('✅ Admin user created: Wool');
  console.log(`   Password: ${password}`);
  console.log('   ⚠️  Change the password after first login!');
  await ds.destroy();
}

seed().catch(e => { console.error(e); process.exit(1); });
