import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [WalletModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
