import { getNextBillingDate, getSubscriptionEndDate } from './billing.util';
import { BillingInterval } from '@prisma/client';

describe('getNextBillingDate', () => {
  const base = new Date('2026-03-07T00:00:00Z');

  it('should add 1 day for DAILY', () => {
    const result = getNextBillingDate(base, BillingInterval.DAILY);
    expect(result).toEqual(new Date('2026-03-08T00:00:00Z'));
  });

  it('should add 7 days for WEEKLY', () => {
    const result = getNextBillingDate(base, BillingInterval.WEEKLY);
    expect(result).toEqual(new Date('2026-03-14T00:00:00Z'));
  });

  it('should add 1 month for MONTHLY', () => {
    const result = getNextBillingDate(base, BillingInterval.MONTHLY);
    expect(result).toEqual(new Date('2026-04-07T00:00:00Z'));
  });

  it('should add 3 months for QUARTERLY', () => {
    const result = getNextBillingDate(base, BillingInterval.QUARTERLY);
    expect(result).toEqual(new Date('2026-06-07T00:00:00Z'));
  });

  it('should add 6 months for BI_ANNUALLY', () => {
    const result = getNextBillingDate(base, BillingInterval.BI_ANNUALLY);
    expect(result).toEqual(new Date('2026-09-07T00:00:00Z'));
  });

  it('should add 1 year for ANNUALLY', () => {
    const result = getNextBillingDate(base, BillingInterval.ANNUALLY);
    expect(result).toEqual(new Date('2027-03-07T00:00:00Z'));
  });
});

describe('getSubscriptionEndDate', () => {
  it('returns one day before the given nextBillingDate', () => {
    const nextBilling = new Date('2026-05-06T00:00:00.000Z');
    const result = getSubscriptionEndDate(nextBilling);
    expect(result.toISOString().split('T')[0]).toBe('2026-05-05');
  });

  it('does not mutate the input date', () => {
    const nextBilling = new Date('2026-05-06T00:00:00.000Z');
    getSubscriptionEndDate(nextBilling);
    expect(nextBilling.toISOString().split('T')[0]).toBe('2026-05-06');
  });

  it('handles month boundary: May 1 yields April 30', () => {
    const result = getSubscriptionEndDate(new Date('2026-05-01T00:00:00.000Z'));
    expect(result).toEqual(new Date('2026-04-30T00:00:00.000Z'));
  });

  it('handles year boundary: Jan 1 2026 yields Dec 31 2025', () => {
    const result = getSubscriptionEndDate(new Date('2026-01-01T00:00:00.000Z'));
    expect(result).toEqual(new Date('2025-12-31T00:00:00.000Z'));
  });

  it('handles leap-year boundary: Mar 1 2024 yields Feb 29 2024', () => {
    const result = getSubscriptionEndDate(new Date('2024-03-01T00:00:00.000Z'));
    expect(result).toEqual(new Date('2024-02-29T00:00:00.000Z'));
  });
});
