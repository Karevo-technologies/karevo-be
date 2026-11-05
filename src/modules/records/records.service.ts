import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/auth/request-user';
import { AppException } from '../../common/errors/app.exception';
import { Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListRecordsQueryDto, RecordView } from './dto/records.dto';

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async list(me: RequestUser, query: ListRecordsQueryDto): Promise<Page<RecordView>> {
    const where: Prisma.HealthRecordWhereInput = {
      userId: me.id,
      ...(query.type ? { type: query.type } : {}),
      ...(query.q
        ? {
            OR: [
              { type: { contains: query.q, mode: 'insensitive' } },
              { summary: { contains: query.q, mode: 'insensitive' } },
              { issuedBy: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.healthRecord.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      include: { issuedBy: { select: { id: true, name: true } } },
      ...pageArgs(query),
    });

    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      type: r.type,
      category: r.category,
      issuedBy: r.issuedBy,
      issuedDate: r.issuedDate.toISOString().slice(0, 10),
      summary: r.summary,
      receivedAt: r.receivedAt.toISOString(),
    }));
  }

  async get(me: RequestUser, id: string): Promise<RecordView> {
    const record = await this.prisma.healthRecord.findFirst({
      where: { id, userId: me.id },
      include: { issuedBy: { select: { id: true, name: true } } },
    });
    if (!record) throw AppException.notFound('Record');

    return {
      id: record.id,
      type: record.type,
      category: record.category,
      issuedBy: record.issuedBy,
      issuedDate: record.issuedDate.toISOString().slice(0, 10),
      summary: record.summary,
      details: this.crypto.decrypt(record.detailsEnc),
      receivedAt: record.receivedAt.toISOString(),
    };
  }
}
