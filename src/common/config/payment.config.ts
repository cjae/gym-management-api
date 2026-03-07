import { registerAs } from '@nestjs/config';

export type PaymentConfig = {
  paystackSecretKey: string;
};

export const getPaymentConfigName = () => 'payment';

export const getPaymentConfig = (): PaymentConfig => {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    throw new Error(
      'PAYSTACK_SECRET_KEY environment variable is required',
    );
  }
  return { paystackSecretKey };
};

export default registerAs(getPaymentConfigName(), getPaymentConfig);
