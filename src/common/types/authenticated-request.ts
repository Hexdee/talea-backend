import type { User } from '@prisma/client';
import type { Request } from 'express';

export type SessionUser = Pick<User, 'id' | 'email' | 'displayName' | 'roles'>;

export type AuthenticatedRequest = Request & {
  sessionUser?: SessionUser | null;
};
