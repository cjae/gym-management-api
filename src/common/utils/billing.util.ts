import { BillingInterval } from '@prisma/client';

export function getNextBillingDate(
  from: Date,
  interval: BillingInterval,
): Date {
  const next = new Date(from);

  switch (interval) {
    case BillingInterval.DAILY:
      next.setDate(next.getDate() + 1);
      break;
    case BillingInterval.WEEKLY:
      next.setDate(next.getDate() + 7);
      break;
    case BillingInterval.MONTHLY:
      next.setMonth(next.getMonth() + 1);
      break;
    case BillingInterval.QUARTERLY:
      next.setMonth(next.getMonth() + 3);
      break;
    case BillingInterval.BI_ANNUALLY:
      next.setMonth(next.getMonth() + 6);
      break;
    case BillingInterval.ANNUALLY:
      next.setFullYear(next.getFullYear() + 1);
      break;
  }

  return next;
}
