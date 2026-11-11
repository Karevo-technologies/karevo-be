import { Injectable } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KAREVO_ID_REGEX } from '../org/dto/org.dto';
import { RequestAdmin } from './admin-context';
import { AdminAuditService } from './admin-audit.service';
import { AdminUserView, NinDecisionDto } from './dto/admin.dto';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/**
 * Patient accounts as Karevo staff see them (admin spec §4.3): metadata only,
 * looked up by Karevo ID (no name search), never record contents.
 * Roles: super_admin, ops_support.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly activity: ActivityService,
  ) {}

  async getByKarevoId(admin: RequestAdmin, rawKarevoId: string): Promise<AdminUserView> {
    const karevoId = rawKarevoId.trim().toUpperCase();
    if (!KAREVO_ID_REGEX.test(karevoId)) throw AppException.validation({ karevoId: 'Enter a Karevo ID like KV-1234-5678' });
    const user = await this.prisma.user.findUnique({ where: { karevoId } });
    if (!user) throw AppException.notFound('Patient');
    // Lookups are logged too, so unusual browsing of patient accounts shows up in the audit log.
    await this.audit.log(admin.id, { action: 'user.view', targetType: 'user', targetId: user.id, reasonCode: 'support_request' });
    return this.toView(user.id);
  }

  /**
   * Manual NIN verification (plan step 2), the production replacement for the
   * stub provider while no NIN vendor is contracted.
   */
  async decideNin(admin: RequestAdmin, userId: string, dto: NinDecisionDto): Promise<AdminUserView> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw AppException.notFound('Patient');
      if (user.ninStatus === dto.decision) throw AppException.conflict(`This NIN is already ${dto.decision}.`);

      await tx.user.update({ where: { id: userId }, data: { ninStatus: dto.decision, ninCheckedAt: new Date() } });
      await tx.linkedId.updateMany({ where: { userId, type: 'nin' }, data: { status: dto.decision } });
      await this.activity.record(userId, 'auth', dto.decision === 'verified' ? 'NIN verified by Karevo' : 'NIN verification failed', {}, tx);
      await this.audit.log(admin.id, { action: 'user.nin_decision', targetType: 'user', targetId: userId, reasonCode: dto.reasonCode, note: dto.note, metadata: { from: user.ninStatus, to: dto.decision } }, tx);
    });
    return this.toView(userId);
  }

  private async toView(userId: string): Promise<AdminUserView> {
    const now = new Date();
    const [user, records, pendingConsents, activeConsents] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.healthRecord.count({ where: { userId } }),
      this.prisma.consentRequest.count({ where: { userId, status: 'pending' } }),
      this.prisma.consentRequest.count({ where: { userId, status: 'active', expiresAt: { gt: now } } }),
    ]);
    return {
      id: user.id,
      karevoId: user.karevoId,
      name: user.name,
      emailMasked: maskEmail(user.email),
      ninMasked: CryptoService.maskNin(user.ninLast4),
      ninStatus: user.ninStatus,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt.toISOString(),
      deactivatedAt: user.deactivatedAt ? user.deactivatedAt.toISOString() : null,
      counts: { records, pendingConsents, activeConsents },
    };
  }
}
