import { registerAs } from '@nestjs/config';

export type AuthConfig = {
  jwtSecret: string;
  jwtRefreshSecret: string;
  basicAuthUser: string;
  basicAuthPassword: string;
};

export const getAuthConfigName = () => 'auth';

export const getAuthConfig = (): AuthConfig => ({
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
  basicAuthUser: process.env.BASIC_AUTH_USER ?? '',
  basicAuthPassword: process.env.BASIC_AUTH_PASSWORD ?? '',
});

export default registerAs(getAuthConfigName(), getAuthConfig);
