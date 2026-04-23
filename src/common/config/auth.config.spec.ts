import { getAuthConfig } from './auth.config';

describe('getAuthConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalJwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const originalBasicAuthUser = process.env.BASIC_AUTH_USER;
  const originalBasicAuthPassword = process.env.BASIC_AUTH_PASSWORD;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
    if (originalJwtRefreshSecret === undefined) {
      delete process.env.JWT_REFRESH_SECRET;
    } else {
      process.env.JWT_REFRESH_SECRET = originalJwtRefreshSecret;
    }
    if (originalBasicAuthUser === undefined) {
      delete process.env.BASIC_AUTH_USER;
    } else {
      process.env.BASIC_AUTH_USER = originalBasicAuthUser;
    }
    if (originalBasicAuthPassword === undefined) {
      delete process.env.BASIC_AUTH_PASSWORD;
    } else {
      process.env.BASIC_AUTH_PASSWORD = originalBasicAuthPassword;
    }
  });

  it('returns the env value when JWT_SECRET and JWT_REFRESH_SECRET are set', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'real-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'real-refresh-secret';
    process.env.BASIC_AUTH_USER = 'user';
    process.env.BASIC_AUTH_PASSWORD = 'pass';

    const config = getAuthConfig();

    expect(config.jwtSecret).toBe('real-jwt-secret');
    expect(config.jwtRefreshSecret).toBe('real-refresh-secret');
    expect(config.basicAuthUser).toBe('user');
    expect(config.basicAuthPassword).toBe('pass');
  });

  it('returns the dev fallback when NODE_ENV=development and secrets are unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASSWORD;

    const config = getAuthConfig();

    expect(config.jwtSecret).toBe('dev-secret');
    expect(config.jwtRefreshSecret).toBe('dev-refresh-secret');
    // Basic auth falls back to '' in dev/test. The runtime strategy
    // rejects every request in that state (fail-closed by default).
    expect(config.basicAuthUser).toBe('');
    expect(config.basicAuthPassword).toBe('');
  });

  it('returns the dev fallback when NODE_ENV=test and secrets are unset', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASSWORD;

    const config = getAuthConfig();

    expect(config.jwtSecret).toBe('dev-secret');
    expect(config.jwtRefreshSecret).toBe('dev-refresh-secret');
    expect(config.basicAuthUser).toBe('');
    expect(config.basicAuthPassword).toBe('');
  });

  it('throws when NODE_ENV=production and JWT_SECRET is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    process.env.BASIC_AUTH_USER = 'u';
    process.env.BASIC_AUTH_PASSWORD = 'p';

    expect(() => getAuthConfig()).toThrow('JWT_SECRET must be set');
  });

  it('throws when NODE_ENV is unset entirely and JWT_SECRET is unset', () => {
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    process.env.BASIC_AUTH_USER = 'u';
    process.env.BASIC_AUTH_PASSWORD = 'p';

    expect(() => getAuthConfig()).toThrow('JWT_SECRET must be set');
  });

  it("throws when NODE_ENV='staging' and JWT_SECRET is unset", () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    process.env.BASIC_AUTH_USER = 'u';
    process.env.BASIC_AUTH_PASSWORD = 'p';

    expect(() => getAuthConfig()).toThrow('JWT_SECRET must be set');
  });

  it('throws for JWT_REFRESH_SECRET when only JWT_SECRET is set outside dev/test', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'real-jwt-secret';
    delete process.env.JWT_REFRESH_SECRET;
    process.env.BASIC_AUTH_USER = 'u';
    process.env.BASIC_AUTH_PASSWORD = 'p';

    expect(() => getAuthConfig()).toThrow('JWT_REFRESH_SECRET must be set');
  });

  it('throws when NODE_ENV=production and BASIC_AUTH_USER is unset', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 's';
    process.env.JWT_REFRESH_SECRET = 'r';
    delete process.env.BASIC_AUTH_USER;
    process.env.BASIC_AUTH_PASSWORD = 'p';

    expect(() => getAuthConfig()).toThrow('BASIC_AUTH_USER must be set');
  });

  it('throws when NODE_ENV=production and BASIC_AUTH_PASSWORD is unset', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 's';
    process.env.JWT_REFRESH_SECRET = 'r';
    process.env.BASIC_AUTH_USER = 'u';
    delete process.env.BASIC_AUTH_PASSWORD;

    expect(() => getAuthConfig()).toThrow('BASIC_AUTH_PASSWORD must be set');
  });

  it('throws when NODE_ENV=production and BASIC_AUTH_USER is empty string', () => {
    // Blank string is the exact scenario H2 was filed for — one env
    // present, the other set to empty string — must throw at boot.
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 's';
    process.env.JWT_REFRESH_SECRET = 'r';
    process.env.BASIC_AUTH_USER = '';
    process.env.BASIC_AUTH_PASSWORD = 'p';

    expect(() => getAuthConfig()).toThrow('BASIC_AUTH_USER must be set');
  });

  it('throws when NODE_ENV=production and BASIC_AUTH_PASSWORD is empty string', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 's';
    process.env.JWT_REFRESH_SECRET = 'r';
    process.env.BASIC_AUTH_USER = 'u';
    process.env.BASIC_AUTH_PASSWORD = '';

    expect(() => getAuthConfig()).toThrow('BASIC_AUTH_PASSWORD must be set');
  });

  it("throws when NODE_ENV='staging' and BASIC_AUTH_* is unset", () => {
    process.env.NODE_ENV = 'staging';
    process.env.JWT_SECRET = 's';
    process.env.JWT_REFRESH_SECRET = 'r';
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASSWORD;

    expect(() => getAuthConfig()).toThrow('BASIC_AUTH_USER must be set');
  });
});
