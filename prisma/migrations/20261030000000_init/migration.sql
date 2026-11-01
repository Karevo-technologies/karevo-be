-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "NinStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "OrgKind" AS ENUM ('hospital', 'insurer', 'pharmacy', 'lab');

-- CreateEnum
CREATE TYPE "ShareCategory" AS ENUM ('id', 'blood', 'allergies', 'vaccines', 'scripts', 'full');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'active', 'declined', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "ShareExpiry" AS ENUM ('1h', '24h', '7d', 'single');

-- CreateEnum
CREATE TYPE "LinkedIdType" AS ENUM ('nin', 'passport', 'drivers_licence', 'voters_card');

-- CreateEnum
CREATE TYPE "LinkedIdStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('create', 'consent', 'auth');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "karevoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "ninEnc" TEXT NOT NULL,
    "ninHash" TEXT NOT NULL,
    "ninLast4" TEXT NOT NULL,
    "ninStatus" "NinStatus" NOT NULL DEFAULT 'pending',
    "ninCheckedAt" TIMESTAMP(3),
    "pinHash" TEXT,
    "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecretEnc" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "location" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OrgKind" NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "issuedById" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "category" "ShareCategory" NOT NULL,
    "issuedDate" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "detailsEnc" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "scope" "ShareCategory"[],
    "purpose" TEXT NOT NULL,
    "requestedDays" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ConsentStatus" NOT NULL DEFAULT 'pending',
    "grantedDays" INTEGER,
    "grantedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ConsentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "label" TEXT,
    "categories" "ShareCategory"[],
    "expiry" "ShareExpiry" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRequest" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID,
    "requestedCategories" "ShareCategory"[],
    "grantedCategories" "ShareCategory"[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedId" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "LinkedIdType" NOT NULL,
    "numberEnc" TEXT NOT NULL,
    "numberLast4" TEXT NOT NULL,
    "status" "LinkedIdStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preferences" (
    "userId" UUID NOT NULL,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifySms" BOOLEAN NOT NULL DEFAULT false,
    "notifyPush" BOOLEAN NOT NULL DEFAULT true,
    "autoSignOutMinutes" INTEGER NOT NULL DEFAULT 15,
    "offlineEnabled" BOOLEAN NOT NULL DEFAULT false,
    "offlineCardOnly" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "event" TEXT NOT NULL,
    "device" TEXT,
    "location" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportJob" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'queued',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_karevoId_key" ON "User"("karevoId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_ninHash_key" ON "User"("ninHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "HealthRecord_userId_receivedAt_idx" ON "HealthRecord"("userId", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "ConsentRequest_userId_status_idx" ON "ConsentRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "ConsentRequest_status_expiresAt_idx" ON "ConsentRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShareToken_codeHash_key" ON "ShareToken"("codeHash");

-- CreateIndex
CREATE INDEX "ShareToken_userId_createdAt_idx" ON "ShareToken"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedId_userId_type_key" ON "LinkedId"("userId", "type");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_occurredAt_idx" ON "ActivityEvent"("userId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecord" ADD CONSTRAINT "HealthRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecord" ADD CONSTRAINT "HealthRecord_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRequest" ADD CONSTRAINT "ConsentRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareToken" ADD CONSTRAINT "ShareToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRequest" ADD CONSTRAINT "ScanRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRequest" ADD CONSTRAINT "ScanRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedId" ADD CONSTRAINT "LinkedId_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preferences" ADD CONSTRAINT "Preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

