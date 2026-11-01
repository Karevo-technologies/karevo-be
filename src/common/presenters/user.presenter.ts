import { NinStatus, User } from '@prisma/client';
import { CryptoService } from '../../crypto/crypto.service';

/** `User` as the API returns it. The NIN is always masked here. */
export interface UserView {
  id: string;
  karevoId: string;
  name: string;
  email: string;
  nin: string;
  ninStatus: NinStatus;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export function toUserView(u: User): UserView {
  return {
    id: u.id,
    karevoId: u.karevoId,
    name: u.name,
    email: u.email,
    nin: CryptoService.maskNin(u.ninLast4),
    ninStatus: u.ninStatus,
    twoFactorEnabled: u.twoFactorEnabled,
    createdAt: u.createdAt.toISOString(),
  };
}
