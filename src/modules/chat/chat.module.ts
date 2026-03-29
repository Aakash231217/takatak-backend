import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { IntimacyService } from './intimacy.service';
import { WalletModule } from '../wallet/wallet.module';
import { GiftModule } from '../gift/gift.module';
import { FraudModule } from '../fraud/fraud.module';
import { VipModule } from '../vip/vip.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    WalletModule,
    GiftModule,
    forwardRef(() => FraudModule),
    VipModule,
    UploadModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret')!,
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiration')! as any,
        },
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, IntimacyService],
  exports: [ChatService, IntimacyService],})
export class ChatModule {}