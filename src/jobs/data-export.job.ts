import { Injectable } from '@nestjs/common';

/**
 * TODO(account owner): picks up `DataExportJob` rows with status `queued`,
 * builds the user's export (profile, records with decrypted details,
 * consents, activity), delivers it, and marks the row `completed`.
 * Format and delivery are an open spec question; see src/modules/account/README.md#export.
 * Add `@Cron(CronExpression.EVERY_MINUTE)` to `run` once it is implemented.
 */
@Injectable()
export class DataExportJob {
  async run(): Promise<void> {}
}
