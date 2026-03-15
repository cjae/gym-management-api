import { randomBytes } from 'crypto';

export function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
}
