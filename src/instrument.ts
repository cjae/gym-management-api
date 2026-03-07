import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { getSentryConfig } from './common/config/sentry.config';

const sentryConfig = getSentryConfig();

Sentry.init({
  dsn: sentryConfig.dsn,
  environment: sentryConfig.environment,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profileSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
