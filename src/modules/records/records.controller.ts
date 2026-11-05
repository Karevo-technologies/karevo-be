import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import { ListRecordsQueryDto, RecordView } from './dto/records.dto';
import { RecordsService } from './records.service';

/** Read-only: records are written by organisations, never by users. */
@ApiTags('Records')
@ApiBearerAuth()
@Controller('records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  list(@CurrentUser() me: RequestUser, @Query() query: ListRecordsQueryDto): Promise<Page<RecordView>> {
    return this.records.list(me, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() me: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<RecordView> {
    return this.records.get(me, id);
  }
}
