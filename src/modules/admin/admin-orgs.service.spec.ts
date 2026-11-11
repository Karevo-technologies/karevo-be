import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgInvitesService } from '../org/org-invites.service';
import { RequestAdmin } from './admin-context';
import { AdminAuditService } from './admin-audit.service';
import { AdminOrgsService } from './admin-orgs.service';

const admin: RequestAdmin = { id: 'admin-1', sessionId: 's-1', role: 'ops_support' };

function setup(status: string) {
  const org = { id: 'org-1', name: 'LUTH', kind: 'hospital', status, createdAt: new Date(), _count: { members: 2 } };
  const prisma: any = {
    organisation: {
      findUnique: jest.fn(async () => org),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => org),
    },
    orgSession: { updateMany: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  const audit = { log: jest.fn() };
  const activity = { recordOrg: jest.fn() };
  const service = new AdminOrgsService(
    prisma as PrismaService,
    audit as unknown as AdminAuditService,
    {} as OrgInvitesService,
    activity as unknown as ActivityService,
  );
  return { service, prisma, audit };
}

describe('AdminOrgsService.transition', () => {
  it('approves a pending organisation, sets verified, and logs the reason', async () => {
    const { service, prisma, audit } = setup('pending');
    await service.transition(admin, 'org-1', 'approve', { reasonCode: 'documents_verified' });

    expect(prisma.organisation.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-1', status: 'pending' },
      data: { status: 'verified', verified: true, statusReason: 'documents_verified' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ action: 'org.approve', reasonCode: 'documents_verified', metadata: { from: 'pending', to: 'verified' } }),
      prisma,
    );
    expect(prisma.orgSession.updateMany).not.toHaveBeenCalled();
  });

  it('ends every staff session when suspending', async () => {
    const { service, prisma } = setup('verified');
    await service.transition(admin, 'org-1', 'suspend', { reasonCode: 'fraud_suspected', note: 'Under investigation' });

    expect(prisma.organisation.updateMany.mock.calls[0][0].data).toEqual({
      status: 'suspended',
      verified: false,
      statusReason: 'Under investigation',
    });
    expect(prisma.orgSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { member: { orgId: 'org-1' }, revokedAt: null } }),
    );
  });

  it.each([
    ['reject', 'verified'],
    ['suspend', 'pending'],
    ['reinstate', 'verified'],
  ] as const)('refuses to %s an organisation that is %s', async (action, status) => {
    const { service, prisma, audit } = setup(status);
    const err = await service.transition(admin, 'org-1', action, { reasonCode: 'other', note: 'test' }).catch((e) => e);
    expect((err as AppException).getStatus()).toBe(409);
    expect(prisma.organisation.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('refuses when another admin changed the status first', async () => {
    const { service, prisma } = setup('pending');
    prisma.organisation.updateMany.mockResolvedValue({ count: 0 });
    const err = await service.transition(admin, 'org-1', 'approve', { reasonCode: 'documents_verified' }).catch((e) => e);
    expect((err as AppException).getStatus()).toBe(409);
  });
});
