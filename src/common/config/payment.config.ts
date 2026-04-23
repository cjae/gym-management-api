import { registerAs } from '@nestjs/config';

export type PaymentConfig = {
  paystackSecretKey: string;
  encryptionKey: string;
  paystackCallbackUrl: string;
  paystackCancelUrl: string;
};

export const getPaymentConfigName = () => 'payment';

const requireEncryptionKeyInSecureEnvs = (
  value: string | undefined,
): string => {
  if (value) return value;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return '';
  }
  throw new Error(
    'ENCRYPTION_KEY must be set outside development/test environments to avoid storing Paystack authorization codes in plaintext',
  );
};

export const getPaymentConfig = (): PaymentConfig => {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    throw new Error('PAYSTACK_SECRET_KEY environment variable is required');
  }
  return {
    paystackSecretKey,
    encryptionKey: requireEncryptionKeyInSecureEnvs(process.env.ENCRYPTION_KEY),
    paystackCallbackUrl: process.env.PAYSTACK_CALLBACK_URL ?? '',
    paystackCancelUrl: process.env.PAYSTACK_CANCEL_URL ?? '',
  };
};

export default registerAs(getPaymentConfigName(), getPaymentConfig);
