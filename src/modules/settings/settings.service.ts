import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/auth/request-user';
import { Page } from '../../common/pagination/pagination';
import { notImplemented } from '../../common/stub';
import {
  ActivityView,
  IntegrityView,
  LinkedIdView,
  ListActivityQueryDto,
  PreferencesView,
  SessionView,
  UpdatePreferencesDto,
} from './dto/settings.dto';

const README = 'src/modules/settings/README.md';

@Injectable()
export class SettingsService {
  getPreferences(_me: RequestUser): Promise<PreferencesView> {
    return notImplemented(`${README}#preferences`);
  }

  updatePreferences(_me: RequestUser, _dto: UpdatePreferencesDto): Promise<PreferencesView> {
    return notImplemented(`${README}#preferences`);
  }

  listLinkedIds(_me: RequestUser): Promise<LinkedIdView[]> {
    return notImplemented(`${README}#linked-ids`);
  }

  listSessions(_me: RequestUser): Promise<SessionView[]> {
    return notImplemented(`${README}#sessions`);
  }

  revokeSession(_me: RequestUser, _id: string): Promise<void> {
    return notImplemented(`${README}#sessions`);
  }

  revokeOtherSessions(_me: RequestUser): Promise<void> {
    return notImplemented(`${README}#sessions`);
  }

  listActivity(_me: RequestUser, _query: ListActivityQueryDto): Promise<Page<ActivityView>> {
    return notImplemented(`${README}#activity`);
  }

  getIntegrity(_me: RequestUser): Promise<IntegrityView> {
    return notImplemented(`${README}#integrity`);
  }
}
