import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { SessionUser } from '../common/types/authenticated-request';
import {
  CompleteSolanaPaymentDto,
  CreateSolanaPaymentDto,
  QuotePurchaseDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments/solana')
@UseGuards(SessionAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('quote')
  @Version('1')
  quotePurchase(
    @CurrentUser() user: SessionUser,
    @Body() dto: QuotePurchaseDto,
  ) {
    return this.paymentsService.quotePurchase(user.id, dto);
  }

  @Post('intents')
  @Version('1')
  createIntent(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreateSolanaPaymentDto,
  ) {
    return this.paymentsService.createIntent(user.id, dto);
  }

  @Post('intents/:reference/complete')
  @Version('1')
  completeIntent(
    @CurrentUser() user: SessionUser,
    @Param('reference') reference: string,
    @Body() dto: CompleteSolanaPaymentDto,
  ) {
    return this.paymentsService.completeIntent(user.id, reference, dto);
  }

  @Get('history')
  @Version('1')
  getPurchaseHistory(@CurrentUser() user: SessionUser) {
    return this.paymentsService.getPurchaseHistory(user.id);
  }
}
