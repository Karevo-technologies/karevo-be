import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, RequireVerifiedNin } from '../../common/auth/decorators';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import { LIMITS } from '../../common/throttle/limits';
import {
  ConfirmScanDto,
  CreateShareTokenDto,
  ListShareTokensQueryDto,
  ResolveScanDto,
  ScanResolveResponse,
  ShareTokenView,
  VisitQrView,
} from './dto/sharing.dto';
import { SharingService } from './sharing.service';

@ApiTags('Sharing')
@ApiBearerAuth()
@Controller('share-tokens')
export class ShareTokensController {
  constructor(private readonly sharing: SharingService) {}

  @Post()
  @RequireVerifiedNin()
  @Throttle(LIMITS.shareTokenCreate)
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateShareTokenDto): Promise<ShareTokenView> {
    return this.sharing.createToken(me, dto);
  }

  @Get()
  list(@CurrentUser() me: RequestUser, @Query() query: ListShareTokensQueryDto): Promise<Page<ShareTokenView>> {
    return this.sharing.listTokens(me, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() me: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sharing.revokeToken(me, id);
  }
}

@ApiTags('Sharing')
@ApiBearerAuth()
@Controller('scan')
export class ScanController {
  constructor(private readonly sharing: SharingService) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedNin()
  resolve(@CurrentUser() me: RequestUser, @Body() dto: ResolveScanDto): Promise<ScanResolveResponse> {
    return this.sharing.resolveScan(me, dto);
  }

  @Post(':requestId/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireVerifiedNin()
  confirm(
    @CurrentUser() me: RequestUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ConfirmScanDto,
  ): Promise<void> {
    return this.sharing.confirmScan(me, requestId, dto);
  }
}

/** In-person visits: the patient shows this QR and the organisation scans it. */
@ApiTags('Sharing')
@ApiBearerAuth()
@Controller('me')
export class VisitQrController {
  constructor(private readonly sharing: SharingService) {}

  @Post('visit-qr')
  @RequireVerifiedNin()
  @Throttle(LIMITS.shareTokenCreate)
  create(@CurrentUser() me: RequestUser): Promise<VisitQrView> {
    return this.sharing.createVisitQr(me);
  }
}
