import { registerAs } from '@nestjs/config';

export type AuthConfig = {
  jwtSecret: string;
  jwtRefreshSecret: string;
  basicAuthUser: string;
  basicAuthPassword: string;
};

export const getAuthConfigName = () => 'auth';

const requireInSecureEnvs = (
  value: string | undefined,
  name: string,
  fallback: string,
): string => {
  if (value) return value;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return fallback;
  }
  throw new Error(`${name} must be set`);
};

export const getAuthConfig = (): AuthConfig => ({
  jwtSecret: requireInSecureEnvs(
    process.env.JWT_SECRET,
    'JWT_SECRET',
    'dev-secret',
  ),
  jwtRefreshSecret: requireInSecureEnvs(
    process.env.JWT_REFRESH_SECRET,
    'JWT_REFRESH_SECRET',
    'dev-refresh-secret',
  ),
  basicAuthUser: process.env.BASIC_AUTH_USER ?? '',
  basicAuthPassword: process.env.BASIC_AUTH_PASSWORD ?? '',
});

export default registerAs(getAuthConfigName(), getAuthConfig);
