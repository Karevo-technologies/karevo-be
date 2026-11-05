import { Injectable, Logger } from '@nestjs/common';

export interface SendPasswordResetOptions {
  to: string;
  name: string;
  token: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendPasswordResetLink(opts: SendPasswordResetOptions): Promise<void> {
    // Never log the token: anyone with log access could reset the account.
    this.logger.log(`Password reset email queued for ${opts.to}`);
  }
}

