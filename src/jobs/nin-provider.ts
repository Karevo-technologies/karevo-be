import { Injectable, Logger } from '@nestjs/common';

export type NinCheckResult = 'verified' | 'failed' | 'pending';

/**
 * Port for NIN verification (spec open question: NIMC direct or a licensed
 * vendor). Implement a provider class and bind it in jobs.module.ts.
 * Return `pending` when the provider is unavailable, so the job retries later.
 */
export abstract class NinProvider {
  abstract verify(nin: string, name: string): Promise<NinCheckResult>;
}

/** Development only: marks every NIN verified. Startup refuses it in production. */
@Injectable()
export class StubNinProvider extends NinProvider {
  private readonly logger = new Logger(StubNinProvider.name);

  async verify(_nin: string, name: string): Promise<NinCheckResult> {
    this.logger.warn(`Stub NIN provider auto-verified "${name}"`);
    return 'verified';
  }
}
