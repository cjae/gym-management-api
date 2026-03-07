import { registerAs } from '@nestjs/config';

export type SentryConfig = {
  dsn: string;
  environment: string;
};

export const getSentryConfigName = () => 'sentry';

export const getSentryConfig = (): SentryConfig => ({
  dsn: process.env.SENTRY_DSN ?? '',
  environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
});

export default registerAs(getSentryConfigName(), getSentryConfig);
