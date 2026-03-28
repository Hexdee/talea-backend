import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { BooksModule } from './books/books.module';
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
    PrismaModule,
    AuthModule,
    HealthModule,
    BooksModule,
    ChaptersModule,
    LibraryModule,
    PaymentsModule,
    AnalyticsModule,
    WalletModule,
  ],
})
export class AppModule {}
