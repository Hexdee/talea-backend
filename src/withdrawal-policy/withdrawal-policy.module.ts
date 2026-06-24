import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { WithdrawalPolicyService } from './withdrawal-policy.service';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [WithdrawalPolicyService],
  exports: [WithdrawalPolicyService],
})
export class WithdrawalPolicyModule {}
