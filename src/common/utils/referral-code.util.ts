import { randomBytes } from 'crypto';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ALPHABET_LEN = ALPHANUMERIC.length; // 36
// Largest multiple of 36 that fits in a byte (252 = 36 * 7)
const MAX_VALID = Math.floor(256 / ALPHABET_LEN) * ALPHABET_LEN;

export function generateReferralCode(): string {
  let code = '';
  while (code.length < 8) {
    const bytes = randomBytes(8 - code.length + 2); // request a few extra to reduce loops
    for (let i = 0; i < bytes.length && code.length < 8; i++) {
      if (bytes[i] < MAX_VALID) {
        code += ALPHANUMERIC[bytes[i] % ALPHABET_LEN];
      }
    }
  }
  return code;
}
