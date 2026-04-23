import { getDatabaseConfig } from './database.config';

describe('getDatabaseConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('returns the env value when DATABASE_URL is a valid postgresql:// URL', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/gym';

    const config = getDatabaseConfig();

    expect(config.url).toBe('postgresql://user:pass@db.example.com:5432/gym');
  });

  it('accepts the postgres:// protocol alias', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:pass@db.example.com:5432/gym';

    const config = getDatabaseConfig();

    expect(config.url).toBe('postgres://user:pass@db.example.com:5432/gym');
  });

  it('returns empty string when NODE_ENV=development and DATABASE_URL is unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_URL;

    const config = getDatabaseConfig();

    expect(config.url).toBe('');
  });

  it('returns empty string when NODE_ENV=test and DATABASE_URL is unset', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DATABASE_URL;

    const config = getDatabaseConfig();

    expect(config.url).toBe('');
  });

  it('throws when NODE_ENV=production and DATABASE_URL is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;

    expect(() => getDatabaseConfig()).toThrow('DATABASE_URL must be set');
  });

  it('throws when NODE_ENV is unset entirely and DATABASE_URL is unset', () => {
    delete process.env.NODE_ENV;
    delete process.env.DATABASE_URL;

    expect(() => getDatabaseConfig()).toThrow('DATABASE_URL must be set');
  });

  it("throws when NODE_ENV='staging' and DATABASE_URL is unset", () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.DATABASE_URL;

    expect(() => getDatabaseConfig()).toThrow('DATABASE_URL must be set');
  });

  it('throws when NODE_ENV=production and DATABASE_URL is empty string', () => {
    // Blank string is the exact missing-value scenario — must throw at boot.
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = '';

    expect(() => getDatabaseConfig()).toThrow('DATABASE_URL must be set');
  });

  it('throws with a format-specific error when DATABASE_URL uses a non-postgres protocol', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'http://not-postgres.example.com/db';

    expect(() => getDatabaseConfig()).toThrow(
      'DATABASE_URL must use postgresql:// or postgres:// protocol',
    );
  });

  it('throws for mysql:// URLs even in dev', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/gym';

    expect(() => getDatabaseConfig()).toThrow(
      'DATABASE_URL must use postgresql:// or postgres:// protocol',
    );
  });

  it('throws with a format-specific error when DATABASE_URL is unparseable', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'not a url at all';

    expect(() => getDatabaseConfig()).toThrow('DATABASE_URL is malformed');
  });

  it('validates format even in development when DATABASE_URL is set but malformed', () => {
    // Dev leniency only applies to a MISSING value — a present-but-wrong
    // value is still a bug that should fail fast.
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'http://localhost:5432/gym';

    expect(() => getDatabaseConfig()).toThrow(
      'DATABASE_URL must use postgresql:// or postgres:// protocol',
    );
  });
});
