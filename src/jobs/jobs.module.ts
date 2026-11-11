import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { DataExportJob } from './data-export.job';
import { ExpiryJob } from './expiry.job';
import { ManualNinProvider, NinProvider, StubNinProvider } from './nin-provider';
import { NinVerificationJob } from './nin-verification.job';

@Module({
  providers: [
    ExpiryJob,
    NinVerificationJob,
    DataExportJob,
    // NIN_PROVIDER picks the provider; env.ts rejects the stub in production. Add the vendor's provider here once chosen.
    {
      provide: NinProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('NIN_PROVIDER', { infer: true }) === 'manual' ? new ManualNinProvider() : new StubNinProvider(),
    },
  ],
})
export class JobsModule {}
