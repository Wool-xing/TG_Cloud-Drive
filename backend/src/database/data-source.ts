import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// P1-I4: entities + migrations path follow NODE_ENV. Pre-fix the file pinned
// `src/**/*.entity.ts` even when running inside the production image, where
// only `dist/` exists — TypeORM CLI invocations (migration:generate/run) hit
// "no entity found" and silently emitted broken migrations. Switch to dist/.js
// in production so `npm run typeorm` works against the same compiled artifact
// the app uses at runtime.
const isProd = process.env.NODE_ENV === 'production';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: isProd ? ['dist/**/*.entity.js'] : ['src/**/*.entity.ts'],
  migrations: isProd
    ? ['dist/database/migrations/*.js']
    : ['src/database/migrations/*.ts'],
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
});
