import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestOrgMember } from './org-context';
import { coveredCategories, OrgPatientsService } from './org-patients.service';

const crypto = new CryptoService(
  new ConfigService({
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
  }) as never,
);

const me: RequestOrgMember = { id: 'member-1', sessionId: 's-1', orgId: 'org-1', role: 'member', orgStatus: 'verified' };
const patient = { id: 'user-1', karevoId: 'KV-1111-2222', name: 'Ada Obi', deactivatedAt: null };
const future = () => new Date(Date.now() + 86_400_000);

function record(id: string, category: string) {
  return {
    id,
    userId: patient.id,
    type: 'Blood Test Result',
    category,
    title: null,
    issuedBy: { id: 'org-9', name: 'Synlab' },
    issuedDate: new Date('2026-07-14'),
    summary: 'Normal',
    detailsEnc: crypto.encrypt('Hb 14.2'),
    notesEnc: null,
    receivedAt: new Date(),
  };
}

function setup() {
  const prisma: any = {
    consentRequest: { findFirst: jest.fn(), findMany: jest.fn() },
    healthRecord: { findMany: jest.fn() },
    recordAccessEvent: { createMany: jest.fn() },
    organisation: { findUniqueOrThrow: jest.fn(async () => ({ name: 'LUTH' })) },
    user: { findUnique: jest.fn(async () => patient) },
    visitGrant: { findFirst: jest.fn(async () => null), create: jest.fn() },
    visitQrToken: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  const activity = { record: jest.fn(), recordOrg: jest.fn() };
  const service = new OrgPatientsService(prisma as PrismaService, crypto, activity as unknown as ActivityService);
  return { service, prisma, activity };
}

describe('coveredCategories', () => {
  it('treats full as every record and id as identity only', () => {
    expect(coveredCategories(['full'])).toBeNull();
    expect(coveredCategories(['id'])).toEqual([]);
    expect(coveredCategories(['blood', 'id', 'vaccines'])).toEqual(['blood', 'vaccines']);
  });
});

describe('OrgPatientsService.consentRecords', () => {
  it('returns only records in scope and audits each read in the same transaction', async () => {
    const { service, prisma, activity } = setup();
    prisma.consentRequest.findFirst.mockResolvedValue({
      id: 'c-1',
      orgId: 'org-1',
      status: 'active',
      expiresAt: future(),
      scope: ['blood'],
      user: patient,
      org: { name: 'LUTH' },
    });
    prisma.healthRecord.findMany.mockResolvedValue([record('r-1', 'blood')]);

    const res = await service.consentRecords(me, 'c-1');

    expect(prisma.healthRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', category: { in: ['blood'] } } }),
    );
    expect(res.records[0].details).toBe('Hb 14.2');
    expect(prisma.recordAccessEvent.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'user-1', recordId: 'r-1', orgId: 'org-1', memberId: 'member-1', via: 'consent', consentId: 'c-1' }],
    });
    expect(activity.record).toHaveBeenCalledWith('user-1', 'consent', 'LUTH viewed 1 of your records', {}, prisma);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired consent', async () => {
    const { service, prisma } = setup();
    prisma.consentRequest.findFirst.mockResolvedValue({
      id: 'c-1',
      status: 'active',
      expiresAt: new Date(Date.now() - 1000),
      scope: ['blood'],
      user: patient,
      org: { name: 'LUTH' },
    });
    const err = await service.consentRecords(me, 'c-1').catch((e) => e);
    expect((err as AppException).getStatus()).toBe(403);
    expect(prisma.healthRecord.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 for another organisation's consent", async () => {
    const { service, prisma } = setup();
    prisma.consentRequest.findFirst.mockResolvedValue(null);
    const err = await service.consentRecords(me, 'c-x').catch((e) => e);
    expect((err as AppException).getStatus()).toBe(404);
    expect(prisma.consentRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c-x', orgId: 'org-1' } }));
  });
});

describe('OrgPatientsService.patientRecords', () => {
  it('refuses without an active consent or visit', async () => {
    const { service, prisma } = setup();
    prisma.consentRequest.findMany.mockResolvedValue([]);
    const err = await service.patientRecords(me, 'kv-1111-2222').catch((e) => e);
    expect((err as AppException).getStatus()).toBe(403);
    expect(prisma.healthRecord.findMany).not.toHaveBeenCalled();
  });

  it('gives every record during a visit grant and records the visit as the source', async () => {
    const { service, prisma } = setup();
    prisma.visitGrant.findFirst.mockResolvedValue({ id: 'v-1', expiresAt: future() });
    prisma.healthRecord.findMany.mockResolvedValue([record('r-1', 'blood'), record('r-2', 'vaccines')]);

    const res = await service.patientRecords(me, 'KV-1111-2222');

    expect(res.via).toBe('visit');
    expect(prisma.healthRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
    expect(prisma.recordAccessEvent.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ recordId: 'r-1', via: 'visit', visitGrantId: 'v-1' }),
      expect.objectContaining({ recordId: 'r-2', via: 'visit', visitGrantId: 'v-1' }),
    ]);
  });
});

describe('OrgPatientsService.redeemVisit', () => {
  const token = {
    id: 'q-1',
    usedAt: null,
    expiresAt: future(),
    user: patient,
  };

  it('creates a 2-hour visit grant from a valid code', async () => {
    const { service, prisma } = setup();
    prisma.visitQrToken.findUnique.mockResolvedValue(token);
    prisma.visitQrToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.visitGrant.create.mockImplementation(async ({ data }: any) => ({ id: 'v-1', ...data }));

    const res = await service.redeemVisit(me, { code: 'kvv1.abcdefghijkl' });

    expect(res.patient.karevoId).toBe('KV-1111-2222');
    const ms = new Date(res.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(119 * 60_000);
    expect(ms).toBeLessThanOrEqual(120 * 60_000);
  });

  it('accepts a code only once, even when two scans race', async () => {
    const { service, prisma } = setup();
    prisma.visitQrToken.findUnique.mockResolvedValue(token);
    prisma.visitQrToken.updateMany.mockResolvedValue({ count: 0 });
    const err = await service.redeemVisit(me, { code: 'kvv1.abcdefghijkl' }).catch((e) => e);
    expect((err as AppException).getStatus()).toBe(400);
    expect(prisma.visitGrant.create).not.toHaveBeenCalled();
  });

  it('refuses a used or expired code', async () => {
    const { service, prisma } = setup();
    prisma.visitQrToken.findUnique.mockResolvedValue({ ...token, usedAt: new Date() });
    await expect(service.redeemVisit(me, { code: 'kvv1.abcdefghijkl' })).rejects.toBeInstanceOf(AppException);
    prisma.visitQrToken.findUnique.mockResolvedValue({ ...token, expiresAt: new Date(Date.now() - 1) });
    await expect(service.redeemVisit(me, { code: 'kvv1.abcdefghijkl' })).rejects.toBeInstanceOf(AppException);
  });
});
