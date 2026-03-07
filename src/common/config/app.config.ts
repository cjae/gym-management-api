import { registerAs } from '@nestjs/config';

export type AppConfig = {
  port: number;
  adminUrl: string;
};

export const getAppConfigName = () => 'app';

export const getAppConfig = (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  adminUrl: process.env.ADMIN_URL ?? 'http://localhost:3001',
});

export default registerAs(getAppConfigName(), getAppConfig);
