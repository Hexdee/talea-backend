import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { FeaturedBooksAdminController } from './featured-books.controller';
import { FeaturedBooksAdminService } from './featured-books.service';
import { WithdrawalPolicyController } from './withdrawal-policy.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [PrismaModule, AuthModule, WalletModule],
  controllers: [
    FeaturedBooksAdminController,
    WithdrawalPolicyController,
    AdminUsersController,
  ],
  providers: [FeaturedBooksAdminService, AdminUsersService],
})
export class AdminModule {}
