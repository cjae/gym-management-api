import { registerAs } from '@nestjs/config';

export type PaymentConfig = {
  paystackSecretKey: string;
};

export const getPaymentConfigName = () => 'payment';

export const getPaymentConfig = (): PaymentConfig => ({
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
});

export default registerAs(getPaymentConfigName(), getPaymentConfig);
