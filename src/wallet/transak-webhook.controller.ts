import { Body, Controller, Headers, Post, Req, Version } from '@nestjs/common';
import type { Request } from 'express';
import { TransakWebhookDto } from '../transak/dto/transak.dto';
import { WalletService } from './wallet.service';

@Controller('wallet/transak')
export class TransakWebhookController {
  constructor(private readonly walletService: WalletService) {}

  @Post('webhook')
  @Version('1')
  receiveWebhook(
    @Body() payload: TransakWebhookDto,
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-signature') xSignature?: string,
    @Headers('transak-signature') transakSignature?: string,
  ) {
    const rawBody =
      request.rawBody?.toString('utf8') ?? JSON.stringify(payload ?? {});
    const signature = xSignature ?? transakSignature;

    return this.walletService.handleTransakWebhook(payload, rawBody, signature);
  }
}
