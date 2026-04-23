import { registerAs } from '@nestjs/config';

export type DatabaseConfig = {
  url: string;
};

export const getDatabaseConfigName = () => 'database';

const isDevOrTest = (): boolean => {
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv === 'development' || nodeEnv === 'test';
};

/**
 * Validates DATABASE_URL at boot so a missing/malformed value fails fast
 * with a clear message rather than surfacing as a cryptic Prisma error on
 * the first DB-hitting request. Mirrors JWT_SECRET / ENCRYPTION_KEY /
 * BASIC_AUTH_* precedent (PR 1 C1/C4, PR 3 H2).
 *
 * - Missing + dev/test: allowed (returns ''), matches the established
 *   leniency pattern — PrismaService still throws "Database URL is not
 *   configured" when actually instantiated, so local dev without a DB
 *   remains possible for unit tests that don't touch Prisma.
 * - Missing + anything else (production, staging, undefined): throws.
 * - Present but wrong protocol: throws with format-specific error.
 * - Present but unparseable: throws with format-specific error.
 */
const validateDatabaseUrl = (value: string | undefined): string => {
  if (!value) {
    if (isDevOrTest()) return '';
    throw new Error('DATABASE_URL must be set');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      'DATABASE_URL is malformed — expected a valid postgres connection string (e.g. postgresql://user:pass@host:5432/db)',
    );
  }

  // URL parses protocol with trailing ':' — normalize before comparing.
  const protocol = parsed.protocol.replace(/:$/, '');
  if (protocol !== 'postgresql' && protocol !== 'postgres') {
    throw new Error(
      `DATABASE_URL must use postgresql:// or postgres:// protocol (got "${protocol}://")`,
    );
  }

  return value;
};

export const getDatabaseConfig = (): DatabaseConfig => ({
  url: validateDatabaseUrl(process.env.DATABASE_URL),
});

export default registerAs(getDatabaseConfigName(), getDatabaseConfig);
