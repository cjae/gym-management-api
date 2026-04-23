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
  // Basic Auth credentials protect login/register endpoints.
  // Outside dev/test, BOTH envs must be non-empty — `requireInSecureEnvs`
  // throws at module load if either is missing so we never boot into a
  // half-configured state where the runtime strategy could fail open.
  // In dev/test, unset envs fall back to '' and the strategy's runtime
  // guard rejects every request (fail-closed by default; opt-in by
  // setting the envs locally).
  basicAuthUser: requireInSecureEnvs(
    process.env.BASIC_AUTH_USER,
    'BASIC_AUTH_USER',
    '',
  ),
  basicAuthPassword: requireInSecureEnvs(
    process.env.BASIC_AUTH_PASSWORD,
    'BASIC_AUTH_PASSWORD',
    '',
  ),
});

export default registerAs(getAuthConfigName(), getAuthConfig);
