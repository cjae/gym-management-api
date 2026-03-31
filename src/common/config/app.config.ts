import { registerAs } from '@nestjs/config';

export type AppConfig = {
  port: number;
  adminUrl: string;
  memberAppUrl: string;
  nodeEnv: string;
};

export const getAppConfigName = () => 'app';

export const getAppConfig = (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  adminUrl: process.env.ADMIN_URL ?? 'http://localhost:3002',
  memberAppUrl:
    process.env.MEMBER_APP_URL ?? 'powerbarnfitness://manage-subscription',
  nodeEnv: process.env.NODE_ENV ?? 'development',
});

export default registerAs(getAppConfigName(), getAppConfig);
