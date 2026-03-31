import { registerAs } from '@nestjs/config';

export type PaymentConfig = {
  paystackSecretKey: string;
  encryptionKey: string;
  paystackCallbackUrl: string;
  paystackCancelUrl: string;
};

export const getPaymentConfigName = () => 'payment';

export const getPaymentConfig = (): PaymentConfig => {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    throw new Error('PAYSTACK_SECRET_KEY environment variable is required');
  }
  return {
    paystackSecretKey,
    encryptionKey: process.env.ENCRYPTION_KEY ?? '',
    paystackCallbackUrl: process.env.PAYSTACK_CALLBACK_URL ?? '',
    paystackCancelUrl: process.env.PAYSTACK_CANCEL_URL ?? '',
  };
};

export default registerAs(getPaymentConfigName(), getPaymentConfig);
