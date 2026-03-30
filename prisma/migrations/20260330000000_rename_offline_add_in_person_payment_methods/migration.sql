-- Rename OFFLINE to MOBILE_MONEY_IN_PERSON and add CARD_IN_PERSON, BANK_TRANSFER_IN_PERSON

-- Add new enum values
ALTER TYPE "PaymentMethod" ADD VALUE 'MOBILE_MONEY_IN_PERSON';
ALTER TYPE "PaymentMethod" ADD VALUE 'CARD_IN_PERSON';
ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_TRANSFER_IN_PERSON';

-- Migrate existing OFFLINE data to MOBILE_MONEY_IN_PERSON
UPDATE "Payment" SET "paymentMethod" = 'MOBILE_MONEY_IN_PERSON' WHERE "paymentMethod" = 'OFFLINE';
UPDATE "MemberSubscription" SET "paymentMethod" = 'MOBILE_MONEY_IN_PERSON' WHERE "paymentMethod" = 'OFFLINE';

-- Remove old OFFLINE value by recreating the enum
-- PostgreSQL doesn't support DROP VALUE, so we rename via a type swap
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";

CREATE TYPE "PaymentMethod" AS ENUM (
  'CARD',
  'CARD_IN_PERSON',
  'MOBILE_MONEY',
  'MOBILE_MONEY_IN_PERSON',
  'BANK_TRANSFER',
  'BANK_TRANSFER_IN_PERSON',
  'COMPLIMENTARY'
);

ALTER TABLE "Payment" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING "paymentMethod"::text::"PaymentMethod";
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING "paymentMethod"::text::"PaymentMethod";

DROP TYPE "PaymentMethod_old";
