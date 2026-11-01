import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import { notImplemented } from '../../common/stub';
import {
  ApproveConsentDto,
  ConsentView,
  ListConsentsQueryDto,
  ResolveConsentDto,
} from './dto/consents.dto';

const README = 'src/modules/consents/README.md';

@Injectable()
export class ConsentsService {
  list(_me: RequestUser, _query: ListConsentsQueryDto): Promise<Page<ConsentView>> {
    return notImplemented(`${README}#list`);
  }

  get(_me: RequestUser, _id: string): Promise<ConsentView> {
    return notImplemented(`${README}#detail`);
  }

  approve(_me: RequestUser, _id: string, _dto: ApproveConsentDto): Promise<ConsentView> {
    return notImplemented(`${README}#approve`);
  }

  decline(_me: RequestUser, _id: string, _dto: ResolveConsentDto): Promise<ConsentView> {
    return notImplemented(`${README}#decline`);
  }

  revoke(_me: RequestUser, _id: string, _dto: ResolveConsentDto): Promise<ConsentView> {
    return notImplemented(`${README}#revoke`);
  }
}
