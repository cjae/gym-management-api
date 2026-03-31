import { PaymentMethod } from '@prisma/client';

/** Payment methods that can be used for admin/in-person subscription creation and CSV imports. */
export const ADMIN_PAYMENT_METHODS = [
  PaymentMethod.MOBILE_MONEY_IN_PERSON,
  PaymentMethod.BANK_TRANSFER_IN_PERSON,
  PaymentMethod.CARD_IN_PERSON,
  PaymentMethod.COMPLIMENTARY,
] as const;

export type AdminPaymentMethod = (typeof ADMIN_PAYMENT_METHODS)[number];
