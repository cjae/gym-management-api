import { encrypt, decrypt } from './encryption.util';
import { randomBytes } from 'crypto';

describe('encryption util', () => {
  const key = randomBytes(32).toString('hex');

  it('should encrypt and decrypt a string', () => {
    const plaintext = 'AUTH_abc123xyz';
    const encrypted = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  it('should produce different ciphertexts for same input (random IV)', () => {
    const plaintext = 'AUTH_abc123xyz';
    const e1 = encrypt(plaintext, key);
    const e2 = encrypt(plaintext, key);
    expect(e1).not.toBe(e2);
  });

  it('should fail with wrong key', () => {
    const plaintext = 'AUTH_abc123xyz';
    const encrypted = encrypt(plaintext, key);
    const wrongKey = randomBytes(32).toString('hex');
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});
