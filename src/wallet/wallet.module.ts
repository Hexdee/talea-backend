import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailsModule } from '../emails/emails.module';
import { TransakWebhookController } from './transak-webhook.controller';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [AuthModule, EmailsModule],
  controllers: [WalletController, TransakWebhookController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
