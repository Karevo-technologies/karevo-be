import { Injectable } from '@nestjs/common';
import { ActivityKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ActivityContext {
  device?: string | null;
  location?: string | null;
  metadata?: Prisma.InputJsonValue;
}

type Db = PrismaService | Prisma.TransactionClient;

/** Badge shown next to an organisation activity entry. */
export type OrgActivityStatus = 'pending' | 'approved' | 'declined' | 'viewed' | 'info';

/**
 * Append-only audit log (spec: "Every write to records, consents, tokens,
 * sessions and PIN appends an ActivityEvent"). Pass the transaction client as
 * `db` so the event commits or rolls back with the write it describes.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  record(userId: string, kind: ActivityKind, event: string, ctx: ActivityContext = {}, db: Db = this.prisma) {
    return db.activityEvent.create({
      data: {
        userId,
        kind,
        event,
        device: ctx.device ?? null,
        location: ctx.location ?? null,
        metadata: ctx.metadata,
      },
    });
  }

  /** The organisation-side log shown on the organisation dashboard's Activity page. */
  recordOrg(
    orgId: string,
    memberId: string | null,
    action: string,
    description: string,
    status: OrgActivityStatus,
    db: Db = this.prisma,
  ) {
    return db.orgActivityEvent.create({ data: { orgId, memberId, action, description, status } });
  }
}
