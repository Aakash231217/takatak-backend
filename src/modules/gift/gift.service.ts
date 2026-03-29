import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { GIFT_CATALOG, GIFT_MAP, GiftItem } from './gift.catalog';

export interface SendGiftResult {
  message: {
    id: string;
    chatId: string;
    senderId: string;
    content: string;
    messageType: string;
    coinCost: number;
    diamondGenerated: number;
    createdAt: Date;
    giftId: string;
    giftName: string;
    giftEmoji: string;
  };
  transaction: {
    transactionId: string;
    coinAmount: number;
    diamondAmount: number;
  };
  gift: GiftItem;
  senderBalance: { totalCoins: number } | null;
  receiverBalance: { diamonds: number } | null;
  otherUserId: string;
}

@Injectable()
export class GiftService {
  private readonly logger = new Logger(GiftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly walletService: WalletService,
  ) {}

  /** Return the full gift catalog. */
  getCatalog(): GiftItem[] {
    return GIFT_CATALOG;
  }

  /** Send a gift in a chat. Deducts coins from sender, credits diamonds to host. */
  async sendGift(
    senderId: string,
    chatId: string,
    giftId: string,
    idempotencyKey: string,
  ): Promise<SendGiftResult> {
    // 1. Validate gift exists
    const gift = GIFT_MAP.get(giftId);
    if (!gift) {
      throw new BadRequestException(`Unknown gift: ${giftId}`);
    }

    // 2. Redis idempotency check
    if (this.redis.isAvailable) {
      const existing = await this.redis.get(`gift:idempotency:${idempotencyKey}`);
      if (existing) {
        throw new BadRequestException('Duplicate gift send request');
      }
    }

    // 3. Validate chat & participant
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, user1Id: true, user2Id: true },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    if (chat.user1Id !== senderId && chat.user2Id !== senderId) {
      throw new BadRequestException('You are not a participant in this chat');
    }

    const receiverId = chat.user1Id === senderId ? chat.user2Id : chat.user1Id;

    // 4. Process payment via wallet service (reuses the battle-tested chat payment flow)
    const txResult = await this.walletService.processChatPayment({
      senderId,
      receiverId,
      coinCost: gift.coinCost,
      diamondGenerated: gift.diamondValue,
      idempotencyKey,
    });

    // 5. Persist gift message (content stores giftId for lookup)
    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId,
        content: `gift:${gift.id}`,
        messageType: 'GIFT',
        coinCost: gift.coinCost,
        diamondGenerated: gift.diamondValue,
      },
    });

    // 7. Cache idempotency in Redis
    if (this.redis.isAvailable) {
      await this.redis.set(
        `gift:idempotency:${idempotencyKey}`,
        message.id,
        300,
      );
    }

    // 8. Fetch updated balances
    let senderBalance: { totalCoins: number } | null = null;
    let receiverBalance: { diamonds: number } | null = null;

    try {
      const sb = await this.walletService.getBalance(senderId);
      senderBalance = { totalCoins: sb.totalCoins };
    } catch (_) {}

    try {
      const rb = await this.walletService.getBalance(receiverId);
      receiverBalance = { diamonds: rb.diamonds };
    } catch (_) {}

    this.logger.log(
      `Gift sent: ${gift.name} from ${senderId} to ${receiverId} in chat ${chatId} (tx: ${txResult.transactionId})`,
    );

    return {
      message: {
        id: message.id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        messageType: message.messageType,
        coinCost: message.coinCost,
        diamondGenerated: message.diamondGenerated,
        createdAt: message.createdAt,
        giftId: gift.id,
        giftName: gift.name,
        giftEmoji: gift.emoji,
      },
      transaction: {
        transactionId: txResult.transactionId,
        coinAmount: txResult.coinAmount,
        diamondAmount: txResult.diamondAmount,
      },
      gift,
      senderBalance,
      receiverBalance,
      otherUserId: receiverId,
    };
  }
}
