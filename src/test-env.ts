import { randomBytes } from 'crypto';

/** Minimal valid environment for unit and wiring tests. No database is contacted. */
export function setTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    CORS_ORIGINS: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    JWT_ADMIN_SECRET: 'test-admin-secret-that-is-also-32-characters-plus',
    COOKIE_SECURE: 'false',
    BREACHED_PASSWORD_CHECK: 'false',
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
  });
}
