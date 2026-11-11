import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivityService } from '../activity/activity.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { NinProvider } from './nin-provider';

const BATCH = 50;

/** Moves users out of `ninStatus: pending` (spec: "Authentication & session" > Registration). */
@Injectable()
export class NinVerificationJob {
  private readonly logger = new Logger(NinVerificationJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly provider: NinProvider,
    private readonly activity: ActivityService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    if (this.running || !this.provider.automatic) return;
    this.running = true;
    try {
      const users = await this.prisma.user.findMany({
        where: { ninStatus: 'pending', deactivatedAt: null },
        orderBy: { ninCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: BATCH,
      });
      for (const user of users) {
        const result = await this.provider.verify(this.crypto.decrypt(user.ninEnc), user.name);
        await this.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { ninCheckedAt: new Date(), ...(result !== 'pending' && { ninStatus: result }) },
          });
          if (result === 'pending') return;
          await tx.linkedId.updateMany({ where: { userId: user.id, type: 'nin' }, data: { status: result } });
          const event = result === 'verified' ? 'NIN verified' : 'NIN verification failed';
          await this.activity.record(user.id, 'auth', event, {}, tx);
        });
      }
    } catch (err) {
      this.logger.error('NIN verification run failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
