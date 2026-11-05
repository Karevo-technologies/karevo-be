import { Prisma, User } from '@prisma/client';
import { matchTotpStep } from '../../crypto/totp';

/**
 * Checks a TOTP code and records its time step, so the same code (or an older
 * one) cannot be used again. The conditional update makes two concurrent
 * requests with one code succeed at most once.
 */
export async function consumeTotpCode(
  db: Prisma.TransactionClient,
  user: Pick<User, 'id' | 'twoFactorLastStep'>,
  secret: string,
  code: string,
): Promise<boolean> {
  const step = matchTotpStep(secret, code);
  if (step === null) return false;
  if (user.twoFactorLastStep !== null && step <= user.twoFactorLastStep) return false;

  const { count } = await db.user.updateMany({
    where: { id: user.id, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
    data: { twoFactorLastStep: step },
  });
  return count === 1;
}
