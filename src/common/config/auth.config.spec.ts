import { getAuthConfig } from './auth.config';

describe('getAuthConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalJwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

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
  });

  it('returns the env value when JWT_SECRET and JWT_REFRESH_SECRET are set', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'real-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'real-refresh-secret';

    const config = getAuthConfig();

    expect(config.jwtSecret).toBe('real-jwt-secret');
    expect(config.jwtRefreshSecret).toBe('real-refresh-secret');
  });

  it('returns the dev fallback when NODE_ENV=development and secrets are unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    const config = getAuthConfig();

    expect(config.jwtSecret).toBe('dev-secret');
    expect(config.jwtRefreshSecret).toBe('dev-refresh-secret');
  });

  it('returns the dev fallback when NODE_ENV=test and secrets are unset', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    const config = getAuthConfig();

    expect(config.jwtSecret).toBe('dev-secret');
    expect(config.jwtRefreshSecret).toBe('dev-refresh-secret');
  });

  it('throws when NODE_ENV=production and JWT_SECRET is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => getAuthConfig()).toThrow('JWT_SECRET must be set');
  });

  it('throws when NODE_ENV is unset entirely and JWT_SECRET is unset', () => {
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => getAuthConfig()).toThrow('JWT_SECRET must be set');
  });

  it("throws when NODE_ENV='staging' and JWT_SECRET is unset", () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => getAuthConfig()).toThrow('JWT_SECRET must be set');
  });

  it('throws for JWT_REFRESH_SECRET when only JWT_SECRET is set outside dev/test', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'real-jwt-secret';
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => getAuthConfig()).toThrow('JWT_REFRESH_SECRET must be set');
  });
});
