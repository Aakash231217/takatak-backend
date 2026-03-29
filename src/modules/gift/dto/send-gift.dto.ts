import { IsUUID, IsString, IsNotEmpty } from 'class-validator';

export class SendGiftDto {
  @IsUUID()
  chatId!: string;

  @IsString()
  @IsNotEmpty()
  giftId!: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
