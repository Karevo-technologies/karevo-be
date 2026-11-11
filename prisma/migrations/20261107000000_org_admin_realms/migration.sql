-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('pending', 'verified', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "OrgMemberStatus" AS ENUM ('invited', 'active', 'removed');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'compliance_officer', 'ops_support', 'analyst');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "AccessVia" AS ENUM ('consent', 'visit', 'admin');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgKind" ADD VALUE 'clinic';
ALTER TYPE "OrgKind" ADD VALUE 'school';
ALTER TYPE "OrgKind" ADD VALUE 'employer';
ALTER TYPE "OrgKind" ADD VALUE 'other';

-- AlterEnum
ALTER TYPE "ShareCategory" ADD VALUE 'certificates';

-- AlterTable
ALTER TABLE "ConsentRequest" ADD COLUMN     "requestedByMemberId" UUID;

-- AlterTable
ALTER TABLE "HealthRecord" ADD COLUMN     "notesEnc" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "uploadedByMemberId" UUID;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "authorisedPerson" TEXT,
ADD COLUMN     "cacNumber" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "OrgStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "OrgMember" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "OrgRole" NOT NULL DEFAULT 'member',
    "status" "OrgMemberStatus" NOT NULL DEFAULT 'invited',
    "invitedById" UUID,
    "activatedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgInvite" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSession" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgActivityEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "memberId" UUID,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitQrToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitQrToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitGrant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordAccessEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "orgId" UUID,
    "memberId" UUID,
    "adminId" UUID,
    "via" "AccessVia" NOT NULL,
    "consentId" UUID,
    "visitGrantId" UUID,
    "reasonCode" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "totpConfirmedAt" TIMESTAMP(3),
    "twoFactorLastStep" INTEGER,
    "status" "AdminStatus" NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminActionLog" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgMember_email_key" ON "OrgMember"("email");

-- CreateIndex
CREATE INDEX "OrgMember_orgId_status_idx" ON "OrgMember"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvite_tokenHash_key" ON "OrgInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "OrgSession_memberId_revokedAt_idx" ON "OrgSession"("memberId", "revokedAt");

-- CreateIndex
CREATE INDEX "OrgActivityEvent_orgId_occurredAt_idx" ON "OrgActivityEvent"("orgId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "VisitQrToken_codeHash_key" ON "VisitQrToken"("codeHash");

-- CreateIndex
CREATE INDEX "VisitGrant_orgId_userId_expiresAt_idx" ON "VisitGrant"("orgId", "userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RecordAccessEvent_userId_accessedAt_idx" ON "RecordAccessEvent"("userId", "accessedAt" DESC);

-- CreateIndex
CREATE INDEX "RecordAccessEvent_orgId_accessedAt_idx" ON "RecordAccessEvent"("orgId", "accessedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminSession_adminId_revokedAt_idx" ON "AdminSession"("adminId", "revokedAt");

-- CreateIndex
CREATE INDEX "AdminActionLog_adminId_occurredAt_idx" ON "AdminActionLog"("adminId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AdminActionLog_targetType_targetId_idx" ON "AdminActionLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminActionLog_occurredAt_idx" ON "AdminActionLog"("occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ConsentRequest_orgId_status_idx" ON "ConsentRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "HealthRecord_userId_category_idx" ON "HealthRecord"("userId", "category");

-- CreateIndex
CREATE INDEX "Organisation_status_idx" ON "Organisation"("status");

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSession" ADD CONSTRAINT "OrgSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgActivityEvent" ADD CONSTRAINT "OrgActivityEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgActivityEvent" ADD CONSTRAINT "OrgActivityEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitQrToken" ADD CONSTRAINT "VisitQrToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitGrant" ADD CONSTRAINT "VisitGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitGrant" ADD CONSTRAINT "VisitGrant_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitGrant" ADD CONSTRAINT "VisitGrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordAccessEvent" ADD CONSTRAINT "RecordAccessEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordAccessEvent" ADD CONSTRAINT "RecordAccessEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "HealthRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordAccessEvent" ADD CONSTRAINT "RecordAccessEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordAccessEvent" ADD CONSTRAINT "RecordAccessEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordAccessEvent" ADD CONSTRAINT "RecordAccessEvent_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordAccessEvent" ADD CONSTRAINT "RecordAccessEvent_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordAccessEvent" ADD CONSTRAINT "RecordAccessEvent_visitGrantId_fkey" FOREIGN KEY ("visitGrantId") REFERENCES "VisitGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecord" ADD CONSTRAINT "HealthRecord_uploadedByMemberId_fkey" FOREIGN KEY ("uploadedByMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_requestedByMemberId_fkey" FOREIGN KEY ("requestedByMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing organisations: keep `status` in step with the old `verified` flag.
UPDATE "Organisation" SET "status" = 'verified' WHERE "verified" = true;

-- Audit tables are append-only. UPDATE and DELETE are refused unless the
-- current transaction sets karevo.audit_maintenance = 'on' (used only by the
-- development seed when it resets the demo data; never by the application).
CREATE OR REPLACE FUNCTION karevo_audit_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('karevo.audit_maintenance', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RecordAccessEvent_append_only"
  BEFORE UPDATE OR DELETE ON "RecordAccessEvent"
  FOR EACH ROW EXECUTE FUNCTION karevo_audit_append_only();

CREATE TRIGGER "AdminActionLog_append_only"
  BEFORE UPDATE OR DELETE ON "AdminActionLog"
  FOR EACH ROW EXECUTE FUNCTION karevo_audit_append_only();
