import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import { notImplemented } from '../../common/stub';
import { ListRecordsQueryDto, RecordView } from './dto/records.dto';

const README = 'src/modules/records/README.md';

@Injectable()
export class RecordsService {
  list(_me: RequestUser, _query: ListRecordsQueryDto): Promise<Page<RecordView>> {
    return notImplemented(`${README}#list`);
  }

  get(_me: RequestUser, _id: string): Promise<RecordView> {
    return notImplemented(`${README}#detail`);
  }
}
