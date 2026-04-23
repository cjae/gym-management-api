import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  DatabaseConfig,
  getDatabaseConfigName,
} from '../common/config/database.config';
import { AppConfig, getAppConfigName } from '../common/config/app.config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const { url } = configService.get<DatabaseConfig>(getDatabaseConfigName())!;
    if (!url) {
      throw new Error('Database URL is not configured');
    }
    const appConfig = configService.get<AppConfig>(getAppConfigName());
    const isProduction = appConfig?.nodeEnv === 'production';
    const useSSL = url.includes('sslmode=') || isProduction;
    // Strip sslmode from URL — pg treats sslmode=require as verify-full,
    // which rejects self-signed certs. We handle SSL explicitly instead.
    const cleanUrl = url
      .replace(/[?&]sslmode=[^&]*/g, (match) =>
        match.startsWith('?') ? '?' : '',
      )
      .replace(/\?$/, '');
    // In production, enforce TLS cert validation against the DB.
    // In non-prod, keep `rejectUnauthorized: false` so local/staging
    // self-signed certs keep working.
    // Ops follow-up: if the production DB uses a self-signed cert, bundle
    // the CA and pass `sslrootcert=/path/to/ca.pem` in DATABASE_URL so
    // validation still passes.
    const sslOption = useSSL
      ? { ssl: { rejectUnauthorized: isProduction } }
      : {};
    const pool = new pg.Pool({
      connectionString: cleanUrl,
      ...sslOption,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
