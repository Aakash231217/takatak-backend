-- Add GIFT_PAYMENT to TransactionType enum
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'GIFT_PAYMENT';

-- Add GIFT to MessageType enum
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'GIFT';
