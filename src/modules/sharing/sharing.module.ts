import { Module } from '@nestjs/common';
import { ScanController, ShareTokensController } from './sharing.controller';
import { SharingService } from './sharing.service';

@Module({
  controllers: [ShareTokensController, ScanController],
  providers: [SharingService],
})
export class SharingModule {}
