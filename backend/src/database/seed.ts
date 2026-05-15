/**
 * Database seeder — run once after first migration to create the admin user.
 *
 * Usage (in production container):  node dist/database/seed.js
 *        (local dev with ts-node):   npx ts-node src/database/seed.ts
 *
 * Reads required values from .env (no hardcoded defaults):
 *   - ADMIN_USERNAME             (e.g. "admin")
 *   - ADMIN_INITIAL_PASSWORD     (strong random; will be force-changed on first login)
 *   - ENCRYPTION_MASTER_KEY      (64 hex chars)
 *   - DATABASE_URL
 *
 * Refuses to run if any required value is missing, a CHANGE_ME_* placeholder,
 * or a known weak default. See backend/src/common/env-validator.ts.
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
import { NodeVersion } from '../files/entities/node-version.entity';
import { FileRequest } from '../files/entities/file-request.entity';
import { Tag } from '../files/entities/tag.entity';
import { Share } from '../shares/entities/share.entity';
import { VerificationCode } from '../verification/verification.entity';
import { hashPassword, generateSalt } from '../common/encryption';
import { validateEnvOrExit } from '../common/env-validator';

async function seed() {
  // Same gate as runtime bootstrap — fail-fast on placeholders / weak defaults.
  validateEnvOrExit();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [User, Device, AuditLog, Node, FileChunk, NodeKey, NodeVersion, FileRequest, Tag, Share, VerificationCode],
    synchronize: true,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await ds.initialize();

  const repo = ds.getRepository(User);
  const existing = await repo.findOne({ where: { username } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`Admin user "${username}" already exists, skipping seed.`);
    await ds.destroy();
    return;
  }

  const admin = repo.create({
    username,
    passwordHash: await hashPassword(password),
    mekSalt: generateSalt(),
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    quotaBytes: 1099511627776, // 1TB for admin
  });

  await repo.save(admin);
  // eslint-disable-next-line no-console
  console.log(`✅ Admin user created: ${username}`);
  // eslint-disable-next-line no-console
  console.log('   ⚠️  Use the password from your .env (ADMIN_INITIAL_PASSWORD) and change it after first login.');
  await ds.destroy();
}

seed().catch(e => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
