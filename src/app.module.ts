import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { BlogModule } from './blog/blog.module';
import { BooksModule } from './books/books.module';
import { ChainModule } from './chain/chain.module';
import { ChaptersModule } from './chapters/chapters.module';
import { envSchema } from './common/config/env.schema';
import { HealthModule } from './health/health.module';
import { LibraryModule } from './library/library.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
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
    PrismaModule,
    AuthModule,
    HealthModule,
    BlogModule,
    BooksModule,
    ChaptersModule,
    LibraryModule,
    PaymentsModule,
    AnalyticsModule,
    WalletModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
