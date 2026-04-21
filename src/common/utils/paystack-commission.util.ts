/**
 * Calculates the total amount to charge the customer,
 * including the merchant's share of the Paystack commission (50/50 split).
 *
 * Paystack full rates: Card 2.9%, M-Pesa 1.5%, Bank transfer flat fee
 * Customer pays half; merchant absorbs the other half.
 *
 * Card:          1.45%  (half of 2.9%)
 * M-Pesa:        0.75%  (half of 1.5%)
 * Bank transfer: 0%     (flat fee fully absorbed by merchant)
 */

const COMMISSION_RATES: Record<string, number> = {
  CARD: 0.0145,
  MOBILE_MONEY: 0.0075,
  BANK_TRANSFER: 0,
};

export function addPaystackCommission(
  amount: number,
  paymentMethod: 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER',
): number {
  const rate = COMMISSION_RATES[paymentMethod] ?? 0;
  return Math.ceil(amount * (1 + rate));
}
