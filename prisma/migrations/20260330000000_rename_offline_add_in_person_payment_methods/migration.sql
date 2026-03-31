-- Rename OFFLINE to MOBILE_MONEY_IN_PERSON and add CARD_IN_PERSON, BANK_TRANSFER_IN_PERSON

-- Drop defaults that reference the old enum type
ALTER TABLE "Payment" ALTER COLUMN "paymentMethod" DROP DEFAULT;
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" DROP DEFAULT;

-- Remove old OFFLINE value and add new values by recreating the enum
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

-- Migrate existing OFFLINE data to MOBILE_MONEY_IN_PERSON during type swap
ALTER TABLE "Payment" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod"
  USING (CASE WHEN "paymentMethod"::text = 'OFFLINE' THEN 'MOBILE_MONEY_IN_PERSON' ELSE "paymentMethod"::text END)::"PaymentMethod";
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod"
  USING (CASE WHEN "paymentMethod"::text = 'OFFLINE' THEN 'MOBILE_MONEY_IN_PERSON' ELSE "paymentMethod"::text END)::"PaymentMethod";

DROP TYPE "PaymentMethod_old";

-- Re-add defaults
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" SET DEFAULT 'MOBILE_MONEY'::"PaymentMethod";
