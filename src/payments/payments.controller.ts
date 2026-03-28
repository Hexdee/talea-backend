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
import { CreateDemoPaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments/demo')
@UseGuards(SessionAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intents')
  @Version('1')
  createIntent(
    @CurrentUser() user: SessionUser,
    @Body() dto: CreateDemoPaymentDto,
  ) {
    return this.paymentsService.createDemoIntent(user.id, dto);
  }

  @Post('intents/:reference/complete')
  @Version('1')
  completeIntent(
    @CurrentUser() user: SessionUser,
    @Param('reference') reference: string,
  ) {
    return this.paymentsService.completeDemoIntent(user.id, reference);
  }

  @Get('history')
  @Version('1')
  getPurchaseHistory(@CurrentUser() user: SessionUser) {
    return this.paymentsService.getPurchaseHistory(user.id);
  }
}
