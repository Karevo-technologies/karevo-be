import { Injectable, Logger } from '@nestjs/common';

export interface SendPasswordResetOptions {
  to: string;
  name: string;
  token: string;
}

export interface SendOrgInviteOptions {
  to: string;
  name: string;
  orgName: string;
  inviteUrl: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendPasswordResetLink(opts: SendPasswordResetOptions): Promise<void> {
    // Never log the token: anyone with log access could reset the account.
    this.logger.log(`Password reset email queued for ${opts.to}`);
  }

  async sendOrgInvite(opts: SendOrgInviteOptions): Promise<void> {
    // The URL carries the invite token, so it is never logged.
    this.logger.log(`Organisation invite email queued for ${opts.to} (${opts.orgName})`);
  }
}
