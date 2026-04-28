import { Global, Module } from '@nestjs/common';
import { TransakService } from './transak.service';

@Global()
@Module({
  providers: [TransakService],
  exports: [TransakService],
})
export class TransakModule {}
