import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from './activity/activity.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { LIMITS } from './common/throttle/limits';
import { KarevoThrottlerGuard } from './common/throttle/karevo-throttler.guard';
import { validateEnv } from './config/env';
import { CryptoModule } from './crypto/crypto.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './mail/mail.module';
import { AccountModule } from './modules/account/account.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConsentsModule } from './modules/consents/consents.module';
import { RecordsModule } from './modules/records/records.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SharingModule } from './modules/sharing/sharing.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ name: 'default', ...LIMITS.default.default }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    ActivityModule,
    AuthModule,
    AccountModule,
    RecordsModule,
    ConsentsModule,
    SharingModule,
    SettingsModule,
    JobsModule,
    MailModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: KarevoThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
