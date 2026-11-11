import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface AdminActionInput {
  action: string;
  targetType: string;
  targetId: string;
  reasonCode: string;
  note?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes the append-only AdminActionLog. Pass the transaction client so the
 * entry commits with the change it describes, or not at all (admin spec §7).
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(adminId: string, input: AdminActionInput, db: Db = this.prisma) {
    return db.adminActionLog.create({
      data: {
        adminId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
        metadata: input.metadata,
      },
    });
  }
}
