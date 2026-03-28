import { CanActivate, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AuthService } from '../auth.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionUser = await this.authService.resolveSessionUser(request);

    if (!sessionUser) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.sessionUser = sessionUser;
    return true;
  }
}
