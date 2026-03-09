import { registerAs } from '@nestjs/config';

export type AuthConfig = {
  jwtSecret: string;
  jwtRefreshSecret: string;
  basicAuthUser: string;
  basicAuthPassword: string;
};

export const getAuthConfigName = () => 'auth';

const requireInProduction = (
  value: string | undefined,
  name: string,
  fallback: string,
): string => {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set in production`);
  }
  return fallback;
};

export const getAuthConfig = (): AuthConfig => ({
  jwtSecret: requireInProduction(
    process.env.JWT_SECRET,
    'JWT_SECRET',
    'dev-secret',
  ),
  jwtRefreshSecret: requireInProduction(
    process.env.JWT_REFRESH_SECRET,
    'JWT_REFRESH_SECRET',
    'dev-refresh-secret',
  ),
  basicAuthUser: process.env.BASIC_AUTH_USER ?? '',
  basicAuthPassword: process.env.BASIC_AUTH_PASSWORD ?? '',
});

export default registerAs(getAuthConfigName(), getAuthConfig);
