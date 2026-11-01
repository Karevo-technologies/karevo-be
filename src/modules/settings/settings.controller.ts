import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import {
  ActivityView,
  IntegrityView,
  LinkedIdView,
  ListActivityQueryDto,
  PreferencesView,
  RevokeSessionsQueryDto,
  SessionView,
  UpdatePreferencesDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings & security')
@ApiBearerAuth()
@Controller('me')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('preferences')
  getPreferences(@CurrentUser() me: RequestUser): Promise<PreferencesView> {
    return this.settings.getPreferences(me);
  }

  @Patch('preferences')
  updatePreferences(@CurrentUser() me: RequestUser, @Body() dto: UpdatePreferencesDto): Promise<PreferencesView> {
    return this.settings.updatePreferences(me, dto);
  }

  @Get('linked-ids')
  listLinkedIds(@CurrentUser() me: RequestUser): Promise<LinkedIdView[]> {
    return this.settings.listLinkedIds(me);
  }

  @Get('sessions')
  listSessions(@CurrentUser() me: RequestUser): Promise<SessionView[]> {
    return this.settings.listSessions(me);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(@CurrentUser() me: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.settings.revokeSession(me, id);
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeOtherSessions(@CurrentUser() me: RequestUser, @Query() _query: RevokeSessionsQueryDto): Promise<void> {
    return this.settings.revokeOtherSessions(me);
  }

  @Get('activity')
  listActivity(@CurrentUser() me: RequestUser, @Query() query: ListActivityQueryDto): Promise<Page<ActivityView>> {
    return this.settings.listActivity(me, query);
  }

  @Get('integrity')
  getIntegrity(@CurrentUser() me: RequestUser): Promise<IntegrityView> {
    return this.settings.getIntegrity(me);
  }
}
