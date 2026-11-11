import { HttpStatus, Injectable } from '@nestjs/common';
import { ConsentRequest, HealthRecord, Organisation, Prisma, ShareCategory } from '@prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CursorQueryDto, Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateConsentRequestDto,
  KAREVO_ID_REGEX,
  ListOrgConsentsQueryDto,
  OrgConsentView,
  OrgRecordView,
  PatientLookupView,
  PatientRecordsView,
  PatientRef,
  RedeemVisitDto,
  UploadedRecordView,
  UploadRecordDto,
  VisitView,
} from './dto/org.dto';
import { ORG_SESSION, RequestOrgMember } from './org-context';

type Tx = Prisma.TransactionClient;
type RecordWithIssuer = HealthRecord & { issuedBy: Pick<Organisation, 'id' | 'name'> };
type ConsentWithRefs = ConsentRequest & {
  user: PatientRef;
  requestedBy: { id: string; name: string } | null;
};

const PATIENT_SELECT = { id: true, karevoId: true, name: true } as const;

/** Record categories a set of consent scopes covers; `null` means every record (`full`). */
export function coveredCategories(scopes: ShareCategory[]): ShareCategory[] | null {
  if (scopes.includes('full')) return null;
  return scopes.filter((s) => s !== 'id');
}

function noAccess(message: string) {
  return new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message);
}

/**
 * The organisation's view of patients. The rule everything here enforces:
 * an organisation reads a patient's records only through an active,
 * unexpired consent whose scope covers them, or a live visit grant, and every
 * read writes a RecordAccessEvent in the same transaction (plan §3).
 */
@Injectable()
export class OrgPatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly activity: ActivityService,
  ) {}

  async lookup(me: RequestOrgMember, rawKarevoId: string): Promise<PatientLookupView> {
    const patient = await this.findPatient(rawKarevoId);
    const now = new Date();
    const [consents, visit] = await Promise.all([
      this.prisma.consentRequest.findMany({
        where: { orgId: me.orgId, userId: patient.id, status: 'active', expiresAt: { gt: now } },
        select: { scope: true },
      }),
      this.activeVisit(this.prisma, me.orgId, patient.id),
    ]);
    const activeScopes = [...new Set(consents.flatMap((c) => c.scope))];
    return {
      karevoId: patient.karevoId,
      name: patient.name,
      activeScopes,
      visitExpiresAt: visit ? visit.expiresAt.toISOString() : null,
    };
  }

  async createConsentRequest(me: RequestOrgMember, dto: CreateConsentRequestDto): Promise<OrgConsentView> {
    const patient = await this.findPatient(dto.karevoId);
    const scope = [...dto.scope].sort();

    const pending = await this.prisma.consentRequest.findMany({
      where: { orgId: me.orgId, userId: patient.id, status: 'pending' },
      select: { scope: true },
    });
    if (pending.some((p) => [...p.scope].sort().join() === scope.join())) {
      throw AppException.conflict('A request for the same records is already waiting for this patient.');
    }

    const consent = await this.prisma.$transaction(async (tx) => {
      const created = await tx.consentRequest.create({
        data: {
          userId: patient.id,
          orgId: me.orgId,
          scope,
          purpose: dto.purpose,
          requestedDays: dto.requestedDays,
          requestedByMemberId: me.id,
        },
        include: { user: { select: PATIENT_SELECT }, requestedBy: { select: { id: true, name: true } } },
      });
      await this.activity.recordOrg(
        me.orgId,
        me.id,
        'Request Sent',
        `Access request sent to ${patient.karevoId} for ${scope.join(', ')}`,
        'pending',
        tx,
      );
      return created;
    });
    return this.toConsentView(consent);
  }

  async listConsentRequests(me: RequestOrgMember, query: ListOrgConsentsQueryDto): Promise<Page<OrgConsentView>> {
    const now = new Date();
    const byTab: Record<typeof query.status, { where: Prisma.ConsentRequestWhereInput; orderBy: Prisma.ConsentRequestOrderByWithRelationInput[] }> = {
      pending: { where: { status: 'pending' }, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }] },
      active: { where: { status: 'active', expiresAt: { gt: now } }, orderBy: [{ expiresAt: 'asc' }, { id: 'desc' }] },
      history: {
        where: { OR: [{ status: { in: ['declined', 'revoked', 'expired'] } }, { status: 'active', expiresAt: { lte: now } }] },
        orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
      },
    };
    const { where, orderBy } = byTab[query.status];
    const rows = await this.prisma.consentRequest.findMany({
      where: { orgId: me.orgId, ...where },
      orderBy,
      include: { user: { select: PATIENT_SELECT }, requestedBy: { select: { id: true, name: true } } },
      ...pageArgs(query),
    });
    return toPage(rows, query.limit, (r) => this.toConsentView(r));
  }

  async getConsentRequest(me: RequestOrgMember, id: string): Promise<OrgConsentView> {
    const consent = await this.prisma.consentRequest.findFirst({
      where: { id, orgId: me.orgId },
      include: { user: { select: PATIENT_SELECT }, requestedBy: { select: { id: true, name: true } } },
    });
    if (!consent) throw AppException.notFound('Request');
    return this.toConsentView(consent);
  }

  /** Records covered by one active consent. Reading them is audited. */
  async consentRecords(me: RequestOrgMember, consentId: string): Promise<PatientRecordsView> {
    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.consentRequest.findFirst({
        where: { id: consentId, orgId: me.orgId },
        include: { user: { select: PATIENT_SELECT }, org: { select: { name: true } } },
      });
      if (!consent) throw AppException.notFound('Request');
      if (consent.status !== 'active' || !consent.expiresAt || consent.expiresAt <= new Date()) {
        throw noAccess('This request is not active, so its records cannot be viewed.');
      }

      const categories = coveredCategories(consent.scope);
      const records = categories && categories.length === 0 ? [] : await this.readRecords(tx, consent.user.id, categories);
      await this.audit(tx, me, consent.org.name, consent.user, records, () => ({ via: 'consent', consentId: consent.id }));
      return { patient: { karevoId: consent.user.karevoId, name: consent.user.name }, via: 'consent', records: records.map((r) => this.toRecordView(r)) };
    });
  }

  /**
   * Everything the organisation may currently read for a patient: all
   * records during a live visit grant, otherwise the union of its active
   * consents' scopes. Reading them is audited.
   */
  async patientRecords(me: RequestOrgMember, rawKarevoId: string): Promise<PatientRecordsView> {
    const patient = await this.findPatient(rawKarevoId);
    return this.prisma.$transaction(async (tx) => {
      const { name: orgName } = await tx.organisation.findUniqueOrThrow({ where: { id: me.orgId }, select: { name: true } });
      const ref = { karevoId: patient.karevoId, name: patient.name };

      const visit = await this.activeVisit(tx, me.orgId, patient.id);
      if (visit) {
        const records = await this.readRecords(tx, patient.id, null);
        await this.audit(tx, me, orgName, patient, records, () => ({ via: 'visit', visitGrantId: visit.id }));
        return { patient: ref, via: 'visit', records: records.map((r) => this.toRecordView(r)) };
      }

      const consents = await tx.consentRequest.findMany({
        where: { orgId: me.orgId, userId: patient.id, status: 'active', expiresAt: { gt: new Date() } },
      });
      if (!consents.length) {
        throw noAccess("You need an active consent, or a scan of the patient's visit QR, to view their records.");
      }

      const all = consents.some((c) => coveredCategories(c.scope) === null);
      const categories = all ? null : [...new Set(consents.flatMap((c) => coveredCategories(c.scope) ?? []))];
      const records = categories && categories.length === 0 ? [] : await this.readRecords(tx, patient.id, categories);
      await this.audit(tx, me, orgName, patient, records, (r) => {
        const consent = consents.find((c) => {
          const covered = coveredCategories(c.scope);
          return covered === null || covered.includes(r.category);
        })!;
        return { via: 'consent', consentId: consent.id };
      });
      return { patient: ref, via: 'consent', records: records.map((r) => this.toRecordView(r)) };
    });
  }

  /** Redeems a patient's single-use visit QR for a time-limited visit grant. */
  async redeemVisit(me: RequestOrgMember, dto: RedeemVisitDto): Promise<VisitView> {
    const invalid = () => AppException.validation({ code: 'This QR code is invalid or has expired. Ask the patient to show a new one.' });
    const token = await this.prisma.visitQrToken.findUnique({
      where: { codeHash: this.crypto.sha256(dto.code) },
      include: { user: { select: { ...PATIENT_SELECT, deactivatedAt: true } } },
    });
    const now = new Date();
    if (!token || token.usedAt || token.expiresAt <= now || token.user.deactivatedAt) throw invalid();

    return this.prisma.$transaction(async (tx) => {
      // Conditional update: a code scanned twice at once is redeemed at most once.
      const used = await tx.visitQrToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: now } });
      if (used.count !== 1) throw invalid();

      const { name: orgName } = await tx.organisation.findUniqueOrThrow({ where: { id: me.orgId }, select: { name: true } });
      const grant = await tx.visitGrant.create({
        data: {
          userId: token.user.id,
          orgId: me.orgId,
          memberId: me.id,
          expiresAt: new Date(now.getTime() + ORG_SESSION.visitGrantMs),
        },
      });
      await this.activity.record(token.user.id, 'consent', `${orgName} can view your records for 2 hours (visit QR)`, { metadata: { visitGrantId: grant.id } }, tx);
      await this.activity.recordOrg(
        me.orgId,
        me.id,
        'Record Access Granted',
        `${token.user.name} (${token.user.karevoId}) shared their visit QR`,
        'approved',
        tx,
      );
      return {
        visitId: grant.id,
        patient: { karevoId: token.user.karevoId, name: token.user.name },
        expiresAt: grant.expiresAt.toISOString(),
      };
    });
  }

  async uploadRecord(me: RequestOrgMember, rawKarevoId: string, dto: UploadRecordDto): Promise<UploadedRecordView> {
    const patient = await this.findPatient(rawKarevoId);
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.healthRecord.create({
        data: {
          userId: patient.id,
          issuedById: me.orgId,
          uploadedByMemberId: me.id,
          title: dto.title,
          type: dto.type,
          category: dto.category,
          issuedDate: new Date(dto.issuedDate),
          summary: dto.summary,
          detailsEnc: this.crypto.encrypt(dto.details),
          notesEnc: dto.notes ? this.crypto.encrypt(dto.notes) : null,
        },
        include: { issuedBy: { select: { name: true } }, uploadedBy: { select: { id: true, name: true } } },
      });
      await this.activity.record(patient.id, 'create', `New record from ${created.issuedBy.name}: ${dto.title}`, { metadata: { recordId: created.id } }, tx);
      await this.activity.recordOrg(me.orgId, me.id, 'Record Uploaded', `${dto.title} (${dto.type}) was uploaded for ${patient.karevoId}`, 'info', tx);
      return created;
    });
    return {
      id: record.id,
      title: record.title,
      type: record.type,
      category: record.category,
      patient: { karevoId: patient.karevoId, name: patient.name },
      uploadedBy: record.uploadedBy,
      issuedDate: record.issuedDate.toISOString().slice(0, 10),
      receivedAt: record.receivedAt.toISOString(),
    };
  }

  /** Records this organisation issued. Metadata only: contents need consent or a visit. */
  async listUploads(me: RequestOrgMember, query: CursorQueryDto): Promise<Page<UploadedRecordView>> {
    const rows = await this.prisma.healthRecord.findMany({
      where: { issuedById: me.orgId },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      include: { user: { select: PATIENT_SELECT }, uploadedBy: { select: { id: true, name: true } } },
      ...pageArgs(query),
    });
    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      category: r.category,
      patient: { karevoId: r.user.karevoId, name: r.user.name },
      uploadedBy: r.uploadedBy,
      issuedDate: r.issuedDate.toISOString().slice(0, 10),
      receivedAt: r.receivedAt.toISOString(),
    }));
  }

  // ---------- helpers ----------

  private async findPatient(rawKarevoId: string) {
    const karevoId = rawKarevoId.trim().toUpperCase();
    if (!KAREVO_ID_REGEX.test(karevoId)) {
      throw AppException.validation({ karevoId: 'Enter a Karevo ID like KV-1234-5678' });
    }
    const patient = await this.prisma.user.findUnique({ where: { karevoId }, select: { ...PATIENT_SELECT, deactivatedAt: true } });
    if (!patient || patient.deactivatedAt) throw AppException.notFound('Patient');
    return patient;
  }

  private activeVisit(db: PrismaService | Tx, orgId: string, userId: string) {
    return db.visitGrant.findFirst({
      where: { orgId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
  }

  private readRecords(tx: Tx, userId: string, categories: ShareCategory[] | null): Promise<RecordWithIssuer[]> {
    return tx.healthRecord.findMany({
      where: { userId, ...(categories ? { category: { in: categories } } : {}) },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      include: { issuedBy: { select: { id: true, name: true } } },
    });
  }

  /** One access event per record, plus one entry on each side's activity log. Same transaction as the read. */
  private async audit(
    tx: Tx,
    me: RequestOrgMember,
    orgName: string,
    patient: { id: string; karevoId: string },
    records: RecordWithIssuer[],
    source: (r: RecordWithIssuer) => { via: 'consent' | 'visit'; consentId?: string; visitGrantId?: string },
  ) {
    if (!records.length) return;
    await tx.recordAccessEvent.createMany({
      data: records.map((r) => ({ userId: patient.id, recordId: r.id, orgId: me.orgId, memberId: me.id, ...source(r) })),
    });
    const n = records.length;
    await this.activity.record(patient.id, 'consent', `${orgName} viewed ${n} of your records`, {}, tx);
    await this.activity.recordOrg(me.orgId, me.id, 'Record Viewed', `${n} record${n === 1 ? '' : 's'} for ${patient.karevoId} viewed`, 'viewed', tx);
  }

  private toRecordView(r: RecordWithIssuer): OrgRecordView {
    return {
      id: r.id,
      title: r.title,
      type: r.type,
      category: r.category,
      issuedBy: r.issuedBy,
      issuedDate: r.issuedDate.toISOString().slice(0, 10),
      summary: r.summary,
      details: this.crypto.decrypt(r.detailsEnc),
      notes: r.notesEnc ? this.crypto.decrypt(r.notesEnc) : null,
      receivedAt: r.receivedAt.toISOString(),
    };
  }

  private toConsentView(c: ConsentWithRefs): OrgConsentView {
    return {
      id: c.id,
      patient: { karevoId: c.user.karevoId, name: c.user.name },
      scope: c.scope,
      purpose: c.purpose,
      // Past its expiry but not yet swept by ExpiryJob: show it as expired.
      status: c.status === 'active' && c.expiresAt && c.expiresAt <= new Date() ? 'expired' : c.status,
      requestedDays: c.requestedDays,
      requestedAt: c.requestedAt.toISOString(),
      requestedBy: c.requestedBy,
      grantedDays: c.grantedDays,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      note: c.note,
    };
  }
}
