import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { setTestEnv } from './test-env';

setTestEnv();

// Required after the env is set, because ConfigModule.forRoot validates when app.module loads.
const { AppModule } = require('./app.module');
const { PrismaService } = require('./prisma/prisma.service');
const { configureApp } = require('./app.setup');

const USER_ID = '6f7c1d1e-0000-4000-8000-000000000001';
const SESSION_ID = '6f7c1d1e-0000-4000-8000-0000000000aa';

/**
 * Boots the real AppModule with Prisma faked out, to check routing, guards,
 * validation and the error shape end to end without a database.
 */
describe('App wiring', () => {
  let app: NestExpressApplication;
  let token: string;
  let ninStatus: 'pending' | 'verified';

  beforeAll(async () => {
    const prisma = {
      session: {
        findUnique: jest.fn(async () => ({
          id: SESSION_ID,
          userId: USER_ID,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          lastActiveAt: new Date(),
          user: { ninStatus, deactivatedAt: null, preferences: { autoSignOutMinutes: 15 } },
        })),
        update: jest.fn(),
      },
      user: { findMany: jest.fn(async () => []) },
      consentRequest: { findMany: jest.fn(async () => []) },
      healthRecord: { findMany: jest.fn(async () => []) },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    token = await app.get(JwtService).signAsync({ sub: USER_ID, sid: SESSION_ID, typ: 'access' });
  });

  beforeEach(() => {
    ninStatus = 'verified';
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('rejects requests without a bearer token', async () => {
    const res = await http().get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
  });

  it('returns field errors in the standard shape', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'not-an-email', nin: '123', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.fields).toEqual(
      expect.objectContaining({
        email: expect.any(String),
        nin: 'NIN must be exactly 11 digits',
        password: expect.any(String),
      }),
    );
  });

  it('rejects unknown body fields', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x', nin: '12345678901', isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('isAdmin');
  });

  it('returns paginated data for implemented endpoints', async () => {
    const res = await http().get('/api/v1/records').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], nextCursor: null });
  });

  it('blocks NIN-gated actions until the NIN is verified', async () => {
    ninStatus = 'pending';
    const res = await http()
      .post(`/api/v1/consents/${SESSION_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ days: 30 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NIN_NOT_VERIFIED');
  });

  it('validates consent days against 7, 30 and 90', async () => {
    const res = await http()
      .post(`/api/v1/consents/${SESSION_ID}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ days: 14 });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.days).toBe('days must be one of 7, 30 or 90');
  });

  it('refuses refresh calls from an untrusted origin', async () => {
    const res = await http().post('/api/v1/auth/refresh').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('answers refresh without a cookie with 401', async () => {
    const res = await http().post('/api/v1/auth/refresh').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(401);
  });
});
