import {
  BadRequestException,
  Controller,
  Body,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import { AdminUsersService } from './admin-users.service';
import {
  ListAdminUsersQueryDto,
  UpdateUserRolesDto,
} from './dto/user-roles.dto';

@ApiTags('admin')
@Controller('admin/users')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @Version('1')
  listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.adminUsersService.listUsers(query.q);
  }

  @Patch(':userId/roles')
  @Version('1')
  updateRoles(
    @CurrentUser() currentUser: SessionUser | null,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRolesDto,
  ) {
    if (!currentUser) {
      throw new BadRequestException('Session user missing.');
    }

    return this.adminUsersService.updateUserRoles({
      currentUserId: currentUser.id,
      userId,
      roles: dto.roles,
    });
  }
}
