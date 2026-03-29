import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisService } from '../../database/redis.service';
import { ChatService } from './chat.service';
import { GiftService } from '../gift/gift.service';
import { SendMessageDto } from './dto';
import { SendGiftDto } from '../gift/dto/send-gift.dto';

interface AuthenticatedSocket extends Socket {
  user: {
    sub: string;
    phone: string;
    role: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: true, // Reflect request origin (allows credentials)
    credentials: true,
  },
  namespace: '/chat',
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly giftService: GiftService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) { }

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');

    // Use @socket.io/redis-adapter for horizontal scaling.
    // This replaces manual psubscribe — the adapter transparently
    // broadcasts all socket.io events across instances via Redis.
    if (!this.redis.isAvailable) {
      this.logger.warn('Redis client not available; running in single-instance mode');
      return;
    }

    const pubClient = this.redis.getClient();

    if (!pubClient) {
      this.logger.warn('Redis pubClient is null; running in single-instance mode');
      return;
    }

    const subClient = pubClient.duplicate();

    subClient.on('error', (err) => {
      this.logger.error('Redis adapter sub client error', err.message);
    });

    this.server.adapter(createAdapter(pubClient, subClient) as any);
    this.logger.log('Redis adapter attached for multi-instance scaling');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      console.log('WS CLIENT CONNECTED TO /chat:', client.id)
      let token =
        client.handshake?.auth?.token ||
        client.handshake?.headers?.authorization;

      if (token?.startsWith('Bearer ')) {
        token = token.split(' ')[1];
      }
      if (!token) {
        this.logger.warn(`Connection rejected: No token provided`);
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
      });

      client.user = payload;

      // Join personal room so we can send targeted events (e.g. newChatNotification)
      client.join(`user:${payload.sub}`);

      // Track user's socket connection (only when Redis is available)
      if (this.redis.isAvailable) {
        await this.redis.set(`socket:${payload.sub}`, client.id, 3600);
      }

      // DEBUG: Log socket connection
      console.log(`[SOCKET] ${payload.sub} connected on /chat namespace (id: ${client.id})`);
      this.logger.log(`Client connected: ${payload.sub} (${client.id})`);
    } catch (err) {
      this.logger.warn(`Connection rejected: Invalid token - ${(err as Error).message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.user) {
      // Only clean up Redis when it is available
      if (this.redis.isAvailable) {
        await this.redis.del(`socket:${client.user.sub}`);
      }
      this.logger.log(`Client disconnected: ${client.user.sub} (${client.id})`);
    }
  }

  @SubscribeMessage('joinChat')
  async handleJoinChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) {
      throw new WsException('Not authenticated');
    }

    const { chatId } = data;

    // Validate user is participant
    try {
      await this.chatService.trackSession(
        client.user.sub,
        chatId,
        client.id,
      );

      client.join(`chat:${chatId}`);

      this.logger.log(
        `[WS] ${client.user.sub} joined room chat:${chatId} (socket ${client.id})`
      );

      this.logger.log(
        `[WS] Rooms for socket ${client.id}: ${JSON.stringify(
          Array.from(client.rooms),
        )}`
      );

      return { event: 'joinedChat', data: { chatId } };
    } catch (err) {
      throw new WsException((err as Error).message);
    }
  }

  @SubscribeMessage('leaveChat')
  async handleLeaveChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) {
      throw new WsException('Not authenticated');
    }

    const { chatId } = data;

    await this.chatService.removeSession(client.user.sub, chatId);
    client.leave(`chat:${chatId}`);

    this.logger.log(`User ${client.user.sub} left chat ${chatId}`);

    return { event: 'leftChat', data: { chatId } };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SendMessageDto,
  ) {
    this.logger.log(
      `[WS] sendMessage received from ${client.user?.sub} for chat ${data.chatId}`
    );

    if (!client.user) {
      client.emit('messageError', { error: 'Not authenticated' });
      return;
    }

    try {
      const messageType = (data.messageType as any) || 'TEXT';
      const result = await this.chatService.sendMessage(
        client.user.sub,
        data.chatId,
        data.content,
        data.idempotencyKey,
        messageType,
        data.mediaUrl,
      );

      this.logger.log(
        `[WS] Broadcasting newMessage to room chat:${data.chatId}`
      );

      // Broadcast to room EXCEPT the sender — the sender receives
      // the authoritative copy via 'messageAck' and reconciles its
      // optimistic bubble. This prevents duplicate messages.
      client
        .to(`chat:${data.chatId}`)
        .emit('newMessage', {
          ...result.message,
          idempotencyKey: data.idempotencyKey,
        });

      this.logger.log(
        `[WS] Emitting messageAck to sender ${client.id} for key ${data.idempotencyKey}`
      );

      client.emit('messageAck', {
        chatId: data.chatId,
        idempotencyKey: data.idempotencyKey,
        messageId: result.message.id,
        createdAt: result.message.createdAt,
        messageType: result.message.messageType,
        mediaUrl: result.message.mediaUrl,
        intimacy: result.intimacy || null,
      });

      if (result.transaction) {
        // Send sender's NEW total coin balance (not just the amount deducted)
        client.emit('paymentConfirmed', {
          transactionId: result.transaction.transactionId,
          coinDeducted: result.transaction.coinAmount,
          senderCoins: result.senderBalance
            ? result.senderBalance.totalCoins
            : null,
        });

        // ── Notify HOST of diamond balance update ──
        if (result.otherUserId && result.receiverBalance) {
          this.server
            .to(`user:${result.otherUserId}`)
            .emit('walletUpdated', {
              diamonds: result.receiverBalance.diamonds,
            });
          this.logger.log(
            `[WS] Emitted walletUpdated (diamonds: ${result.receiverBalance.diamonds}) to user:${result.otherUserId}`
          );
        }
      }

      // Notify the OTHER participant so their chat list auto-refreshes.
      // We emit to the `user:<id>` personal room (each socket joins on connect).
      if (result.otherUserId) {
        this.server
          .to(`user:${result.otherUserId}`)
          .emit('newChatNotification', {
            chatId: data.chatId,
            senderId: client.user.sub,
          });

        // ── Emit intimacy update to the HOST so their badge updates too ──
        if (result.intimacy) {
          this.server
            .to(`user:${result.otherUserId}`)
            .emit('intimacyUpdated', {
              chatId: data.chatId,
              intimacy: result.intimacy,
            });
          this.logger.log(
            `[WS] Emitted intimacyUpdated to user:${result.otherUserId}`
          );
        }

        this.logger.log(
          `[WS] Emitted newChatNotification to user:${result.otherUserId}`
        );
      }

    } catch (err) {
      this.logger.error(
        `[WS] sendMessage failed: ${(err as Error).message}`
      );

      client.emit('messageError', {
        idempotencyKey: data.idempotencyKey,
        error: (err as Error).message,
      });
    }
  }

  @SubscribeMessage('sendGift')
  async handleSendGift(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SendGiftDto,
  ) {
    if (!client.user) {
      client.emit('messageError', { error: 'Not authenticated' });
      return;
    }

    try {
      const result = await this.giftService.sendGift(
        client.user.sub,
        data.chatId,
        data.giftId,
        data.idempotencyKey,
      );

      // Broadcast gift message to room (excluding sender)
      client.to(`chat:${data.chatId}`).emit('newMessage', {
        ...result.message,
        idempotencyKey: data.idempotencyKey,
      });

      // Ack to sender
      client.emit('messageAck', {
        chatId: data.chatId,
        idempotencyKey: data.idempotencyKey,
        messageId: result.message.id,
        createdAt: result.message.createdAt,
        messageType: 'GIFT',
        giftId: result.message.giftId,
        giftName: result.message.giftName,
        giftEmoji: result.message.giftEmoji,
      });

      // Payment confirmation to sender
      client.emit('paymentConfirmed', {
        transactionId: result.transaction.transactionId,
        coinDeducted: result.transaction.coinAmount,
        senderCoins: result.senderBalance?.totalCoins ?? null,
      });

      // Wallet update to host
      if (result.receiverBalance) {
        this.server
          .to(`user:${result.otherUserId}`)
          .emit('walletUpdated', {
            diamonds: result.receiverBalance.diamonds,
          });
      }

      // Gift received animation event to host
      this.server
        .to(`user:${result.otherUserId}`)
        .emit('giftReceived', {
          chatId: data.chatId,
          senderId: client.user.sub,
          gift: result.gift,
        });

      // New chat notification
      this.server
        .to(`user:${result.otherUserId}`)
        .emit('newChatNotification', {
          chatId: data.chatId,
          senderId: client.user.sub,
        });

      this.logger.log(
        `[WS] Gift ${result.gift.name} sent from ${client.user.sub} in chat ${data.chatId}`,
      );
    } catch (err) {
      this.logger.error(`[WS] sendGift failed: ${(err as Error).message}`);
      client.emit('messageError', {
        idempotencyKey: data.idempotencyKey,
        error: (err as Error).message,
      });
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) return;

    client.to(`chat:${data.chatId}`).emit('userTyping', {
      userId: client.user.sub,
      chatId: data.chatId,
    });
  }

  @SubscribeMessage('stopTyping')
  async handleStopTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) return;

    client.to(`chat:${data.chatId}`).emit('userStoppedTyping', {
      userId: client.user.sub,
      chatId: data.chatId,
    });
  }
}
