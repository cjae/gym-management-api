/**
 * Calculates the total amount to charge the customer,
 * including Paystack commission passed through to them.
 *
 * Card (local):    2.9%
 * M-Pesa:          1.5%
 * Bank transfer:   0% (flat fee absorbed by merchant)
 */

const COMMISSION_RATES: Record<string, number> = {
  CARD: 0.029,
  MOBILE_MONEY: 0.015,
  BANK_TRANSFER: 0,
};

export function addPaystackCommission(
  amount: number,
  paymentMethod: 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER',
): number {
  const rate = COMMISSION_RATES[paymentMethod] ?? 0;
  return Math.ceil(amount * (1 + rate));
}
