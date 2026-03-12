/*
  Warnings:

  - The values [CASH] on the enum `PaymentMethod` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('CARD', 'MPESA', 'MPESA_OFFLINE', 'BANK_TRANSFER', 'COMPLIMENTARY');
ALTER TABLE "public"."MemberSubscription" ALTER COLUMN "paymentMethod" DROP DEFAULT;
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");
ALTER TABLE "Payment" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod_new" USING ("paymentMethod"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "public"."PaymentMethod_old";
ALTER TABLE "MemberSubscription" ALTER COLUMN "paymentMethod" SET DEFAULT 'MPESA';
COMMIT;
