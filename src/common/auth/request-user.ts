import { NinStatus } from '@prisma/client';

/** What JwtAuthGuard attaches to `req.user` on every authenticated request. */
export interface RequestUser {
  id: string;
  sessionId: string;
  ninStatus: NinStatus;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'access';
}
