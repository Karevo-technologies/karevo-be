/**
 * Creates a Karevo admin. The only way to create the first super admin, since
 * there is no admin sign-up.
 *
 *   npm run admin:create -- --email ada@karevo.ng --name "Ada Obi" --role super_admin
 *
 * Prints a generated password once; store it in a password manager. The admin
 * sets up their authenticator app (MFA) on first sign-in.
 */
import { AdminRole, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

const ROLES = Object.values(AdminRole);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  const role = (arg('role') ?? 'super_admin') as AdminRole;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
    throw new Error('Usage: npm run admin:create -- --email <email> --name "<name>" [--role <role>]');
  }
  if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);

  const prisma = new PrismaClient();
  try {
    if (await prisma.adminUser.findUnique({ where: { email } })) throw new Error(`An admin with email ${email} already exists`);
    const password = randomBytes(18).toString('base64url');
    await prisma.adminUser.create({
      data: { email, name, role, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
    });
    console.log(`Created ${role} ${email}`);
    console.log(`Password (shown once): ${password}`);
    console.log('MFA is set up at first sign-in.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
