/**
 * Development seed: one verified demo user plus the frontend's mock records
 * and consents, so the dashboard has data to render once wired up.
 *
 *   Email:    demo@karevo.ng
 *   Password: KarevoDemo#2026
 *   NIN:      12345678901
 *
 * Organisation dashboard (Lagos University Teaching Hospital, verified):
 *   Admin:    org.admin@karevo.test / KarevoOrg#2026
 *   Member:   org.member@karevo.test / KarevoOrg#2026
 *
 * Admin dashboard:
 *   Super admin: super.admin@karevo.test / KarevoAdmin#2026
 *   (MFA is set up on first sign-in: scan the setup QR with an authenticator app.)
 *
 * Run with `npm run db:seed`. Re-running replaces the demo user's data.
 */
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../src/config/env';
import { CryptoService } from '../src/crypto/crypto.service';

const DEMO = { email: 'demo@karevo.ng', password: 'KarevoDemo#2026', nin: '12345678901', name: 'Adaeze Okafor' };
const DAY = 24 * 60 * 60 * 1000;
const ORG_PASSWORD = 'KarevoOrg#2026';
const ADMIN_PASSWORD = 'KarevoAdmin#2026';

async function main() {
  const env = validateEnv(process.env);
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');

  const prisma = new PrismaClient();
  const crypto = new CryptoService(new ConfigService(env) as never);

  // Record-access events are append-only (database trigger); the seed is the one
  // place allowed to clear them, inside a transaction that switches the guard off.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('karevo.audit_maintenance', 'on', true)`;
    await tx.user.deleteMany({ where: { email: DEMO.email } });
  });

  const [synlab, gwarinpa, luth, axa, medplus] = await Promise.all(
    [
      { name: 'Synlab Diagnostics, Lagos', kind: 'lab' as const },
      { name: 'Gwarinpa Primary Health Centre, Abuja', kind: 'hospital' as const },
      { name: 'Lagos University Teaching Hospital', kind: 'hospital' as const },
      { name: 'AXA Mansard Health', kind: 'insurer' as const },
      { name: 'MedPlus Pharmacy, Ikeja', kind: 'pharmacy' as const },
    ].map(async (o) =>
      (await prisma.organisation.findFirst({ where: { name: o.name } })) ??
      prisma.organisation.create({ data: { ...o, verified: true, status: 'verified' } }),
    ),
  );

  const ninEnc = crypto.encrypt(DEMO.nin);
  const user = await prisma.user.create({
    data: {
      karevoId: 'KV-2847-9931',
      name: DEMO.name,
      email: DEMO.email,
      passwordHash: await crypto.hashSecret(DEMO.password),
      ninEnc,
      ninHash: crypto.blindIndex(DEMO.nin),
      ninLast4: DEMO.nin.slice(-4),
      ninStatus: 'verified',
      ninCheckedAt: new Date(),
      preferences: { create: {} },
      linkedIds: { create: { type: 'nin', numberEnc: ninEnc, numberLast4: DEMO.nin.slice(-4), status: 'verified' } },
    },
  });

  // Mirrors karevo-users-dashboard/src/dashboard/records/mockPatientRecords.ts
  await prisma.healthRecord.createMany({
    data: [
      {
        userId: user.id,
        issuedById: synlab.id,
        type: 'Blood Test Result',
        category: 'blood',
        issuedDate: new Date('2026-07-14'),
        summary: 'Full blood count and lipid profile — all markers within normal range.',
        detailsEnc: crypto.encrypt(
          'Full Blood Count (FBC): Hemoglobin 14.2 g/dL, WBC 6.1 x10^9/L, Platelets 250 x10^9/L — all within normal limits. Lipid Profile: Total Cholesterol 168 mg/dL, LDL 92 mg/dL, HDL 54 mg/dL, Triglycerides 110 mg/dL. Fasting Blood Glucose: 88 mg/dL. No abnormalities detected. Reviewed by Dr. Chidinma Okoye, MBBS.',
        ),
        receivedAt: new Date('2026-07-14T11:32:00Z'),
      },
      {
        userId: user.id,
        issuedById: gwarinpa.id,
        type: 'Vaccination History',
        category: 'vaccines',
        issuedDate: new Date('2026-05-02'),
        summary: 'Updated immunization record including yellow fever booster.',
        detailsEnc: crypto.encrypt(
          'Yellow Fever (booster) administered 2026-05-02, batch YF-2291. Hepatitis B (3rd dose) administered 2026-05-02, batch HB-4410. Tetanus Toxoid administered 2026-05-02, batch TT-1187. No adverse reactions observed post-administration. Next recommended review: routine annual check. Recorded by Nurse Amaka Eze.',
        ),
        receivedAt: new Date('2026-05-02T09:05:00Z'),
      },
    ],
  });

  const now = Date.now();
  await prisma.consentRequest.createMany({
    data: [
      {
        userId: user.id,
        orgId: luth.id,
        scope: ['blood', 'vaccines'],
        purpose: 'To review your recent lab results ahead of your consultation.',
        requestedDays: 30,
        requestedAt: new Date(now - 2 * 60 * 60 * 1000),
      },
      {
        userId: user.id,
        orgId: axa.id,
        scope: ['id', 'full'],
        purpose: 'Claim assessment for your recent hospital visit.',
        requestedDays: 90,
        requestedAt: new Date(now - DAY),
      },
      {
        userId: user.id,
        orgId: medplus.id,
        scope: ['scripts', 'allergies'],
        purpose: 'Dispensing your prescription safely.',
        requestedDays: 30,
        requestedAt: new Date(now - 10 * DAY),
        status: 'active',
        grantedDays: 30,
        grantedAt: new Date(now - 9 * DAY),
        expiresAt: new Date(now + 21 * DAY),
      },
      {
        userId: user.id,
        orgId: synlab.id,
        scope: ['blood'],
        purpose: 'Follow-up testing.',
        requestedDays: 7,
        requestedAt: new Date(now - 40 * DAY),
        status: 'declined',
        resolvedAt: new Date(now - 39 * DAY),
        note: 'Not needed any more.',
      },
    ],
  });

  await prisma.activityEvent.createMany({
    data: [
      { userId: user.id, kind: 'create', event: 'Account created', occurredAt: new Date(now - 60 * DAY) },
      { userId: user.id, kind: 'consent', event: `Granted ${medplus.name} access for 30 days`, occurredAt: new Date(now - 9 * DAY) },
      { userId: user.id, kind: 'consent', event: `Declined ${synlab.name}`, occurredAt: new Date(now - 39 * DAY) },
    ],
  });

  // Organisation staff for LUTH. Upserts, so re-seeding keeps their history.
  const orgPasswordHash = await crypto.hashSecret(ORG_PASSWORD);
  for (const m of [
    { email: 'org.admin@karevo.test', name: 'Dr. Aminu Bello', role: 'admin' as const },
    { email: 'org.member@karevo.test', name: 'Mrs. Folake Adewale', role: 'member' as const },
  ]) {
    const data = { orgId: luth.id, name: m.name, role: m.role, status: 'active' as const, passwordHash: orgPasswordHash, activatedAt: new Date(), removedAt: null };
    await prisma.orgMember.upsert({ where: { email: m.email }, create: { email: m.email, ...data }, update: data });
  }
  await prisma.organisation.update({
    where: { id: luth.id },
    data: { cacNumber: 'RC-100234', email: 'records@luth.example', phone: '+2348012345678', authorisedPerson: 'Dr. Aminu Bello' },
  });

  // Super admin with MFA reset, so the next sign-in walks through authenticator setup.
  const adminData = {
    name: 'Karevo Super Admin',
    role: 'super_admin' as const,
    status: 'active' as const,
    passwordHash: await crypto.hashSecret(ADMIN_PASSWORD),
    totpSecretEnc: null,
    totpConfirmedAt: null,
    twoFactorLastStep: null,
  };
  await prisma.adminUser.upsert({ where: { email: 'super.admin@karevo.test' }, create: { email: 'super.admin@karevo.test', ...adminData }, update: adminData });

  console.log(`Seeded ${DEMO.email} / ${DEMO.password} / NIN ${DEMO.nin}`);
  console.log(`Org staff: org.admin@karevo.test, org.member@karevo.test / ${ORG_PASSWORD}`);
  console.log(`Super admin: super.admin@karevo.test / ${ADMIN_PASSWORD} (set up MFA at first sign-in)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
