import { Injectable } from '@nestjs/common';
import { Prisma, ShareCategory, ShareToken } from '@prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { RequestUser } from '../../common/auth/request-user';
import { AppException } from '../../common/errors/app.exception';
import { Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConfirmScanDto,
  CreateShareTokenDto,
  EXPIRY_FROM_DB,
  EXPIRY_TO_DB,
  ExpiryValue,
  ListShareTokensQueryDto,
  ResolveScanDto,
  ScanResolveResponse,
  ShareTokenView,
  VisitQrView,
} from './dto/sharing.dto';

const VISIT_QR_TTL_MS = 5 * 60 * 1000;

const EXPIRY_DURATIONS_MS: Record<Exclude<ExpiryValue, 'single'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

function toShareTokenView(t: ShareToken, plainCode?: string): ShareTokenView {
  return {
    id: t.id,
    ...(plainCode ? { code: plainCode } : {}),
    label: t.label,
    categories: t.categories,
    expiry: EXPIRY_FROM_DB[t.expiry],
    expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
    usedAt: t.usedAt ? t.usedAt.toISOString() : null,
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly activity: ActivityService,
  ) {}

  async createToken(me: RequestUser, dto: CreateShareTokenDto): Promise<ShareTokenView> {
    const now = new Date();
    const expiresAt =
      dto.expiry === 'single' ? null : new Date(now.getTime() + EXPIRY_DURATIONS_MS[dto.expiry]);

    for (let attempt = 0; attempt < 3; attempt++) {
      const code = this.crypto.shareCode();
      const codeHash = this.crypto.blindIndex(code);

      try {
        const token = await this.prisma.$transaction(async (tx) => {
          const created = await tx.shareToken.create({
            data: {
              userId: me.id,
              codeHash,
              label: dto.label ?? null,
              categories: dto.categories,
              expiry: EXPIRY_TO_DB[dto.expiry],
              expiresAt,
            },
          });
          await this.activity.record(me.id, 'create', 'Share token created', {}, tx);
          return created;
        });

        return toShareTokenView(token, code);
      } catch (err: any) {
        // Unique constraint violation on codeHash retry
        if (err?.code === 'P2002' && attempt < 2) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('Could not allocate a unique share token code');
  }

  async listTokens(me: RequestUser, query: ListShareTokensQueryDto): Promise<Page<ShareTokenView>> {
    const now = new Date();
    const where: Prisma.ShareTokenWhereInput = {
      userId: me.id,
      ...(query.active
        ? {
            revokedAt: null,
            usedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          }
        : {}),
    };

    const rows = await this.prisma.shareToken.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(query),
    });

    return toPage(rows, query.limit, (t) => toShareTokenView(t));
  }

  async revokeToken(me: RequestUser, id: string): Promise<void> {
    const now = new Date();
    const result = await this.prisma.shareToken.updateMany({
      where: { id, userId: me.id, revokedAt: null },
      data: { revokedAt: now },
    });

    if (result.count === 0) {
      throw AppException.notFound('Share token');
    }

    await this.activity.record(me.id, 'create', 'Share token revoked');
  }

  async resolveScan(me: RequestUser, dto: ResolveScanDto): Promise<ScanResolveResponse> {
    const parsed = this.parseQrPayload(dto.payload);
    const scan = await this.prisma.scanRequest.findUnique({
      where: { id: parsed.requestId },
      include: { org: { select: { id: true, name: true, kind: true, verified: true } } },
    });

    if (!scan) throw AppException.notFound('Scan request');

    const now = new Date();
    if (scan.expiresAt <= now) {
      throw AppException.conflict('This scan request has expired.');
    }
    if (scan.confirmedAt) {
      throw AppException.conflict('This scan request has already been confirmed.');
    }
    if (scan.userId && scan.userId !== me.id) {
      throw AppException.conflict('This scan request was claimed by another user.');
    }

    // Claim only if still unclaimed (or already ours), so two users cannot both resolve it.
    const claimed = await this.prisma.scanRequest.updateMany({
      where: {
        id: scan.id,
        confirmedAt: null,
        OR: [{ userId: null }, { userId: me.id }],
      },
      data: { userId: me.id },
    });
    if (claimed.count === 0) {
      throw AppException.conflict('This scan request was claimed by another user.');
    }

    return {
      org: scan.org,
      requestedCategories: scan.requestedCategories,
      requestId: scan.id,
    };
  }

  async confirmScan(me: RequestUser, requestId: string, dto: ConfirmScanDto): Promise<void> {
    const scan = await this.prisma.scanRequest.findUnique({ where: { id: requestId } });
    if (!scan || scan.userId !== me.id) {
      throw AppException.notFound('Scan request');
    }

    const now = new Date();
    if (scan.expiresAt <= now) {
      throw AppException.conflict('This scan request has expired.');
    }
    if (scan.confirmedAt) {
      throw AppException.conflict('This scan request has already been confirmed.');
    }

    const requestedSet = new Set<ShareCategory>(scan.requestedCategories);
    const validSubset = dto.categories.every((c) => requestedSet.has(c));
    if (!validSubset) {
      throw AppException.validation({
        categories: 'Granted categories must be a subset of requested categories.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.scanRequest.update({
        where: { id: requestId },
        data: {
          grantedCategories: dto.categories,
          confirmedAt: now,
        },
      });

      await this.activity.record(me.id, 'consent', 'QR scan access confirmed', { metadata: { requestId } }, tx);
    });
  }

  /**
   * Single-use code the patient shows as a QR at an in-person visit (plan Q2).
   * It expires in 5 minutes; an organisation redeems it with POST /org/visits
   * for a 2-hour visit grant. Only a SHA-256 of the code is stored.
   */
  async createVisitQr(me: RequestUser): Promise<VisitQrView> {
    const code = `kvv1.${this.crypto.randomToken(24)}`;
    const expiresAt = new Date(Date.now() + VISIT_QR_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      // Showing a new code cancels any earlier unused one.
      await tx.visitQrToken.updateMany({ where: { userId: me.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.visitQrToken.create({ data: { userId: me.id, codeHash: this.crypto.sha256(code), expiresAt } });
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  private parseQrPayload(payload: string): { requestId: string } {
    // Expected format: kv1.<requestId> or kv1.<requestId>.<signature>
    const parts = payload.trim().split('.');
    if (parts.length < 2 || parts[0] !== 'kv1') {
      throw AppException.validation({ payload: 'Invalid QR code format.' });
    }

    const requestId = parts[1];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(requestId)) {
      throw AppException.validation({ payload: 'Invalid scan request ID in QR payload.' });
    }

    return { requestId };
  }
}
