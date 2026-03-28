import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type {
  AuthenticatedRequest,
  SessionUser,
} from '../../common/types/authenticated-request';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRoles: SessionUser['roles'] = request.sessionUser?.roles ?? [];

    if (!requiredRoles.some((role) => userRoles.includes(role))) {
      throw new ForbiddenException('You do not have access to this resource.');
    }

    return true;
  }
}
