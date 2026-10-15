import { defineConfig } from 'prisma/config';

// Prisma 7 connection config. Migration commands read
// `DATABASE_URL` from the environment (`.env` locally, real secret
// in production). No Accelerate, no extra datasource — direct
// PostgreSQL only (ADR-003).
//
// The local fallback mirrors `.env.example` so
// `prisma validate/generate` work without a live database.
const LOCAL_DATABASE_URL =
  'postgresql://phantom:phantom@localhost:5432/phantom_permission_dev';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  },
});
