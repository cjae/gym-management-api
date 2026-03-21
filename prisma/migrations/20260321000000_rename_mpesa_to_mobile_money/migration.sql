-- Rename PaymentMethod enum values: MPESA -> MOBILE_MONEY, MPESA_OFFLINE -> OFFLINE

-- Remove default before altering the type
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" DROP DEFAULT;

-- Rename enum values
ALTER TYPE "PaymentMethod" RENAME VALUE 'MPESA' TO 'MOBILE_MONEY';
ALTER TYPE "PaymentMethod" RENAME VALUE 'MPESA_OFFLINE' TO 'OFFLINE';

-- Restore the default with the new value
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" SET DEFAULT 'MOBILE_MONEY';
