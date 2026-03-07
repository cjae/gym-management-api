import { getNextBillingDate } from './billing.util';
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
