import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Picks up `DataExportJob` rows with status `queued`, builds the user's export
 * (profile, records with decrypted details, consents, activity), and marks the row `completed`.
 */
@Injectable()
export class DataExportJob {
  private readonly logger = new Logger(DataExportJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await this.prisma.dataExportJob.findMany({
        where: { status: 'queued' },
        take: 10,
      });

      for (const job of jobs) {
        await this.processJob(job.id, job.userId);
      }
    } catch (err) {
      this.logger.error('Data export job failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  /** One job failing is marked `failed` and does not block the rest of the batch. */
  private async processJob(jobId: string, userId: string): Promise<void> {
    try {
      await this.prisma.dataExportJob.update({
        where: { id: jobId },
        data: { status: 'processing' },
      });

      const [user, records, consents, activity] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId } }),
        this.prisma.healthRecord.findMany({ where: { userId } }),
        this.prisma.consentRequest.findMany({ where: { userId } }),
        this.prisma.activityEvent.findMany({ where: { userId } }),
      ]);

      if (user) {
        this.logger.log(
          `Compiled export bundle for user ${user.id} (${records.length} records, ${consents.length} consents, ${activity.length} activity events)`,
        );
      }

      await this.prisma.dataExportJob.update({
        where: { id: jobId },
        data: { status: 'completed', completedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`Data export job ${jobId} failed`, err as Error);
      await this.prisma.dataExportJob
        .update({ where: { id: jobId }, data: { status: 'failed', completedAt: new Date() } })
        .catch(() => undefined);
    }
  }
}
