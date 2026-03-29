import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { validateEnv } from './config/validation.schema';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './database/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ChatModule } from './modules/chat/chat.module';
import { ReferralModule } from './modules/referral/referral.module';
import { VipModule } from './modules/vip/vip.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { WithdrawalModule } from './modules/withdrawal/withdrawal.module';
import { HostModule } from './modules/host/host.module';
import { AgencyModule } from './modules/agency/agency.module';
import { AdminModule } from './modules/admin/admin.module';
import { FollowModule } from './modules/follow/follow.module';
import { HealthModule } from './modules/health/health.module';
import { UploadModule } from './modules/upload/upload.module';
import { GiftModule } from './modules/gift/gift.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
        limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
      },
    ]),
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    WalletModule,
    ChatModule,
    ReferralModule,
    VipModule,
    FraudModule,
    WithdrawalModule,
    HostModule,
    AgencyModule,
    AdminModule,
    FollowModule,
    HealthModule,
    UploadModule,
    GiftModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
