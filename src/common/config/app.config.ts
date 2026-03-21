import { registerAs } from '@nestjs/config';

export type AppConfig = {
  port: number;
  adminUrl: string;
  nodeEnv: string;
};

export const getAppConfigName = () => 'app';

export const getAppConfig = (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  adminUrl: process.env.ADMIN_URL ?? 'http://localhost:3002',
  nodeEnv: process.env.NODE_ENV ?? 'development',
});

export default registerAs(getAppConfigName(), getAppConfig);
