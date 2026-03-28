import { CanActivate, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AuthService } from '../auth.service';

@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.sessionUser = await this.authService.resolveSessionUser(request);
    return true;
  }
}
