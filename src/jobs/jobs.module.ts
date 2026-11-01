import { Module } from '@nestjs/common';
import { DataExportJob } from './data-export.job';
import { ExpiryJob } from './expiry.job';
import { NinProvider, StubNinProvider } from './nin-provider';
import { NinVerificationJob } from './nin-verification.job';

@Module({
  providers: [
    ExpiryJob,
    NinVerificationJob,
    DataExportJob,
    // Swap for the real provider once chosen; env.ts already rejects the stub in production.
    { provide: NinProvider, useClass: StubNinProvider },
  ],
})
export class JobsModule {}
