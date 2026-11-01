import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const BATCH = 500;

/**
 * Marks active consents `expired` once `expiresAt` passes (spec: "Expiry").
 * Share tokens need no sweep: a token is dead when revokedAt, usedAt or a past
 * expiresAt is set, and every read checks that (docs/DECISIONS.md, D-07).
 */
@Injectable()
export class ExpiryJob {
  private readonly logger = new Logger(ExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    try {
      let expired: number;
      do {
        expired = await this.expireBatch(new Date());
        if (expired) this.logger.log(`Expired ${expired} consent(s)`);
      } while (expired === BATCH);
    } catch (err) {
      this.logger.error('Consent expiry run failed', err as Error);
    }
  }

  async expireBatch(now: Date): Promise<number> {
    const due = await this.prisma.consentRequest.findMany({
      where: { status: 'active', expiresAt: { lte: now } },
      select: { id: true, userId: true, org: { select: { name: true } } },
      take: BATCH,
    });
    if (!due.length) return 0;

    await this.prisma.$transaction([
      this.prisma.consentRequest.updateMany({
        where: { id: { in: due.map((c) => c.id) }, status: 'active' },
        data: { status: 'expired', resolvedAt: now },
      }),
      this.prisma.activityEvent.createMany({
        data: due.map((c) => ({
          userId: c.userId,
          kind: 'consent' as const,
          event: `Access for ${c.org.name} expired`,
          metadata: { consentId: c.id },
        })),
      }),
    ]);
    return due.length;
  }
}
