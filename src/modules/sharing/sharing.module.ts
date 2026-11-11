import { Module } from '@nestjs/common';
import { ScanController, ShareTokensController, VisitQrController } from './sharing.controller';
import { SharingService } from './sharing.service';

@Module({
  controllers: [ShareTokensController, ScanController, VisitQrController],
  providers: [SharingService],
})
export class SharingModule {}
