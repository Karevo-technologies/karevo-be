import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireVerifiedNin } from '../../common/auth/decorators';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import { ConsentsService } from './consents.service';
import {
  ApproveConsentDto,
  ConsentView,
  ListConsentsQueryDto,
  ResolveConsentDto,
} from './dto/consents.dto';

@ApiTags('Consents')
@ApiBearerAuth()
@Controller('consents')
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get()
  list(@CurrentUser() me: RequestUser, @Query() query: ListConsentsQueryDto): Promise<Page<ConsentView>> {
    return this.consents.list(me, query);
  }

  @Get(':id')
  get(@CurrentUser() me: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ConsentView> {
    return this.consents.get(me, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedNin()
  approve(
    @CurrentUser() me: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveConsentDto,
  ): Promise<ConsentView> {
    return this.consents.approve(me, id, dto);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedNin()
  decline(
    @CurrentUser() me: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveConsentDto,
  ): Promise<ConsentView> {
    return this.consents.decline(me, id, dto);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequireVerifiedNin()
  revoke(
    @CurrentUser() me: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveConsentDto,
  ): Promise<ConsentView> {
    return this.consents.revoke(me, id, dto);
  }
}
