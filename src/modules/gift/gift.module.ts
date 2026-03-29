import { Module } from '@nestjs/common';
import { GiftController } from './gift.controller';
import { GiftService } from './gift.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [GiftController],
  providers: [GiftService],
  exports: [GiftService],
})
export class GiftModule {}
