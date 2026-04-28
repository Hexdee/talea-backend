import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({
  imports: [ReconciliationModule, AuthModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
