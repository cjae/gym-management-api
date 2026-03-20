import { registerAs } from '@nestjs/config';

export type DatabaseConfig = {
  url: string;
};

export const getDatabaseConfigName = () => 'database';

export const getDatabaseConfig = (): DatabaseConfig => ({
  url: process.env.DATABASE_URL ?? '',
});

export default registerAs(getDatabaseConfigName(), getDatabaseConfig);
