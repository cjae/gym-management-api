/**
 * Calculates the total amount to charge the customer,
 * including Paystack commission passed through to them.
 *
 * Card (local): 2.9%
 * M-Pesa:       1.5%
 */

const CARD_RATE = 0.029;
const MPESA_RATE = 0.015;

export function addPaystackCommission(
  amount: number,
  paymentMethod: 'CARD' | 'MPESA',
): number {
  const rate = paymentMethod === 'CARD' ? CARD_RATE : MPESA_RATE;
  return Math.ceil(amount * (1 + rate));
}
