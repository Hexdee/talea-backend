import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthAccountProvider, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type UpdateUserRolesInput = {
  currentUserId: string;
  userId: string;
  roles?: Role[];
};

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query?: string) {
    const trimmed = query?.trim();

    const users = await this.prisma.user.findMany({
      where: trimmed
        ? {
            OR: [
              { email: { contains: trimmed, mode: Prisma.QueryMode.insensitive } },
              {
                displayName: {
                  contains: trimmed,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : undefined,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        createdAt: true,
        updatedAt: true,
        authAccounts: {
          select: {
            provider: true,
          },
        },
      },
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      hasLocalAccount: user.authAccounts.some(
        (account) => account.provider === AuthAccountProvider.LOCAL,
      ),
    }));
  }

  async updateUserRoles(input: UpdateUserRolesInput) {
    if (input.currentUserId === input.userId) {
      throw new BadRequestException(
        'You cannot change your own roles from this screen.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        roles: true,
        email: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const nextRoles = Array.from(
      new Set([Role.USER, ...(input.roles ?? [])]),
    );
    const removingSuperadmin = user.roles.includes(Role.SUPERADMIN) && !nextRoles.includes(Role.SUPERADMIN);

    if (removingSuperadmin) {
      const superadminCount = await this.prisma.user.count({
        where: {
          roles: {
            has: Role.SUPERADMIN,
          },
        },
      });

      if (superadminCount <= 1) {
        throw new BadRequestException(
          'At least one superadmin must remain assigned.',
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        roles: nextRoles,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        createdAt: true,
        updatedAt: true,
        authAccounts: {
          select: {
            provider: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      roles: updated.roles,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      hasLocalAccount: updated.authAccounts.some(
        (account) => account.provider === AuthAccountProvider.LOCAL,
      ),
    };
  }
}
