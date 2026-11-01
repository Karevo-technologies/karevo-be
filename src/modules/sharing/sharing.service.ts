import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import { notImplemented } from '../../common/stub';
import {
  ConfirmScanDto,
  CreateShareTokenDto,
  ListShareTokensQueryDto,
  ResolveScanDto,
  ScanResolveResponse,
  ShareTokenView,
} from './dto/sharing.dto';

const README = 'src/modules/sharing/README.md';

@Injectable()
export class SharingService {
  createToken(_me: RequestUser, _dto: CreateShareTokenDto): Promise<ShareTokenView> {
    return notImplemented(`${README}#create-token`);
  }

  listTokens(_me: RequestUser, _query: ListShareTokensQueryDto): Promise<Page<ShareTokenView>> {
    return notImplemented(`${README}#list-tokens`);
  }

  revokeToken(_me: RequestUser, _id: string): Promise<void> {
    return notImplemented(`${README}#revoke-token`);
  }

  resolveScan(_me: RequestUser, _dto: ResolveScanDto): Promise<ScanResolveResponse> {
    return notImplemented(`${README}#qr-scan`);
  }

  confirmScan(_me: RequestUser, _requestId: string, _dto: ConfirmScanDto): Promise<void> {
    return notImplemented(`${README}#qr-scan`);
  }
}
