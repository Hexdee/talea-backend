import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChainModule } from './chain/chain.module';
import { envSchema } from './common/config/env.schema';
import { LedgerModule } from './ledger/ledger.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    ChainModule,
    LedgerModule,
    ReconciliationModule,
  ],
})
export class WorkerModule {}
