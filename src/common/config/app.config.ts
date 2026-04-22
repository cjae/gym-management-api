import { registerAs } from '@nestjs/config';

export type AppConfig = {
  port: number;
  adminUrl: string;
  memberAppUrl: string;
  nodeEnv: string;
  trustProxyHops: number;
};

export const getAppConfigName = () => 'app';

const parseTrustProxyHops = (value: string | undefined): number => {
  // Number of reverse-proxy hops in front of the app (Nginx, Heroku router,
  // CloudFront, etc). Used by express `trust proxy` so `req.ip` resolves to
  // the real client IP — required for rate-limit buckets to be per-client.
  // Safe default of 1 covers the common single-proxy topology.
  const parsed = parseInt(value ?? '1', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 1;
  }
  return parsed;
};

export const getAppConfig = (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  adminUrl: process.env.ADMIN_URL ?? 'http://localhost:3002',
  memberAppUrl:
    process.env.MEMBER_APP_URL ?? 'powerbarnfitness://manage-subscription',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  trustProxyHops: parseTrustProxyHops(process.env.TRUST_PROXY_HOPS),
});

export default registerAs(getAppConfigName(), getAppConfig);
