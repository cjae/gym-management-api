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

/**
 * Derives the current billing cycle start date by subtracting one interval
 * from nextBillingDate. Falls back to startDate if nextBillingDate is not set.
 */
export function getCycleStartDate(
  nextBillingDate: Date | null,
  startDate: Date,
  interval: BillingInterval,
): Date {
  if (!nextBillingDate) return startDate;

  const cycleStart = new Date(nextBillingDate);

  switch (interval) {
    case BillingInterval.DAILY:
      cycleStart.setDate(cycleStart.getDate() - 1);
      break;
    case BillingInterval.WEEKLY:
      cycleStart.setDate(cycleStart.getDate() - 7);
      break;
    case BillingInterval.MONTHLY:
      cycleStart.setMonth(cycleStart.getMonth() - 1);
      break;
    case BillingInterval.QUARTERLY:
      cycleStart.setMonth(cycleStart.getMonth() - 3);
      break;
    case BillingInterval.BI_ANNUALLY:
      cycleStart.setMonth(cycleStart.getMonth() - 6);
      break;
    case BillingInterval.ANNUALLY:
      cycleStart.setFullYear(cycleStart.getFullYear() - 1);
      break;
  }

  return cycleStart;
}
