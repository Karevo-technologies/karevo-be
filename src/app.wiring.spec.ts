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
const MEMBER_ID = '6f7c1d1e-0000-4000-8000-0000000000b1';
const ADMIN_ID = '6f7c1d1e-0000-4000-8000-0000000000c1';
const live = () => ({ revokedAt: null, expiresAt: new Date(Date.now() + 60_000), lastActiveAt: new Date() });

/**
 * Boots the real AppModule with Prisma faked out, to check routing, guards,
 * validation and the error shape end to end without a database.
 */
describe('App wiring', () => {
  let app: NestExpressApplication;
  let token: string;
  let ninStatus: 'pending' | 'verified';
  let orgToken: string;
  let adminToken: string;
  let orgRole: 'admin' | 'member';
  let orgStatus: 'pending' | 'verified';
  let adminRole: 'super_admin' | 'analyst';

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
      orgSession: {
        findUnique: jest.fn(async () => ({
          id: SESSION_ID,
          memberId: MEMBER_ID,
          ...live(),
          member: { status: 'active', role: orgRole, orgId: 'org-1', org: { status: orgStatus } },
        })),
        update: jest.fn(),
      },
      adminSession: {
        findUnique: jest.fn(async () => ({
          id: SESSION_ID,
          adminId: ADMIN_ID,
          ...live(),
          admin: { status: 'active', role: adminRole },
        })),
        update: jest.fn(),
      },
      adminUser: {
        findUnique: jest.fn(async () => ({ id: ADMIN_ID, email: 'a@karevo.ng', name: 'A', role: adminRole })),
      },
      $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    const jwt = app.get(JwtService);
    token = await jwt.signAsync({ sub: USER_ID, sid: SESSION_ID, typ: 'access' });
    orgToken = await jwt.signAsync({ sub: MEMBER_ID, sid: SESSION_ID, typ: 'org_access' });
    adminToken = await jwt.signAsync(
      { sub: ADMIN_ID, sid: SESSION_ID, typ: 'admin_access' },
      { secret: process.env.JWT_ADMIN_SECRET },
    );
  });

  beforeEach(() => {
    ninStatus = 'verified';
    orgRole = 'admin';
    orgStatus = 'verified';
    adminRole = 'super_admin';
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

  describe('realms', () => {
    const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

    it('serves the health check without a token', async () => {
      const res = await http().get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    });

    it.each([
      ['a patient token', '/api/v1/org/me', () => token],
      ['a patient token', '/api/v1/admin/me', () => token],
      ['an organisation token', '/api/v1/me', () => orgToken],
      ['an organisation token', '/api/v1/admin/me', () => orgToken],
      ['an admin token', '/api/v1/me', () => adminToken],
      ['an admin token', '/api/v1/org/me', () => adminToken],
    ])('refuses %s on %s', async (_label, path, t) => {
      const res = await http().get(path).set(bearer(t()));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('lets each token into its own realm', async () => {
      expect((await http().get('/api/v1/admin/me').set(bearer(adminToken))).status).toBe(200);
    });

    it('enforces admin roles on the server', async () => {
      adminRole = 'analyst';
      const res = await http().get('/api/v1/admin/orgs').set(bearer(adminToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('limits team management to organisation admins', async () => {
      orgRole = 'member';
      const res = await http()
        .post('/api/v1/org/members')
        .set(bearer(orgToken))
        .send({ name: 'New Person', email: 'new@org.ng', role: 'member' });
      expect(res.status).toBe(403);
    });

    it('blocks patient work until Karevo approves the organisation', async () => {
      orgStatus = 'pending';
      const res = await http().get('/api/v1/org/patients/KV-1111-2222').set(bearer(orgToken));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_NOT_VERIFIED');
    });

    it('requires a reason code on admin actions', async () => {
      const res = await http()
        .post('/api/v1/admin/orgs/6f7c1d1e-0000-4000-8000-0000000000d1/approve')
        .set(bearer(adminToken))
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toHaveProperty('reasonCode');
    });
  });
});
