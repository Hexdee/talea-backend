import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BlogModule } from './blog/blog.module';
import { BooksModule } from './books/books.module';
import { ChainModule } from './chain/chain.module';
import { ChaptersModule } from './chapters/chapters.module';
import { envSchema } from './common/config/env.schema';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { LibraryModule } from './library/library.module';
import { OpsModule } from './ops/ops.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.THROTTLE_TTL_SECONDS ?? '60') * 1000,
          limit: Number(process.env.THROTTLE_LIMIT ?? '120'),
        },
      ],
    }),
    ChainModule,
    LedgerModule,
    PrismaModule,
    AdminModule,
    AuthModule,
    HealthModule,
    BlogModule,
    BooksModule,
    ChaptersModule,
    LibraryModule,
    OpsModule,
    PaymentsModule,
    AnalyticsModule,
    WalletModule,
    ReconciliationModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
