import { redactSensitive, REDACTED_PLACEHOLDER } from './redact-sensitive';

describe('redactSensitive', () => {
  it('redacts top-level password key', () => {
    const result = redactSensitive({ email: 'a@b.com', password: 'hunter2' });
    expect(result).toEqual({
      email: 'a@b.com',
      password: REDACTED_PLACEHOLDER,
    });
  });

  it('redacts nested sensitive keys (deep walk)', () => {
    const result = redactSensitive({
      outer: {
        inner: {
          currentPassword: 'old',
          newPassword: 'new',
          name: 'Alice',
        },
      },
    });
    expect(result).toEqual({
      outer: {
        inner: {
          currentPassword: REDACTED_PLACEHOLDER,
          newPassword: REDACTED_PLACEHOLDER,
          name: 'Alice',
        },
      },
    });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const result = redactSensitive({
      users: [
        { id: '1', token: 'abc', name: 'A' },
        { id: '2', token: 'def', name: 'B' },
      ],
    });
    expect(result).toEqual({
      users: [
        { id: '1', token: REDACTED_PLACEHOLDER, name: 'A' },
        { id: '2', token: REDACTED_PLACEHOLDER, name: 'B' },
      ],
    });
  });

  it('matches keys case-insensitively', () => {
    const result = redactSensitive({
      Password: 'x',
      PASSWORD: 'y',
      AccessToken: 'z',
      paystackauthorizationcode: 'pc',
    });
    expect(result).toEqual({
      Password: REDACTED_PLACEHOLDER,
      PASSWORD: REDACTED_PLACEHOLDER,
      AccessToken: REDACTED_PLACEHOLDER,
      paystackauthorizationcode: REDACTED_PLACEHOLDER,
    });
  });

  it('leaves non-sensitive fields untouched', () => {
    const input = {
      id: 'u-1',
      firstName: 'Alice',
      amount: 1500,
      active: true,
      meta: { tag: 'vip' },
    };
    const result = redactSensitive(input);
    expect(result).toEqual(input);
  });

  it('does not mutate the input', () => {
    const input = { password: 'hunter2', name: 'A' };
    const clone = { ...input };
    redactSensitive(input);
    expect(input).toEqual(clone);
  });

  it('preserves Date values untouched', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const result = redactSensitive({ createdAt: when, password: 'x' });
    expect(result.createdAt).toBe(when);
    expect(result.password).toBe(REDACTED_PLACEHOLDER);
  });

  it('handles null and primitives', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(true)).toBe(true);
  });

  it('redacts every sensitive key variant we advertise', () => {
    const input = {
      password: 'a',
      currentPassword: 'a',
      newPassword: 'a',
      token: 'a',
      refreshToken: 'a',
      accessToken: 'a',
      authorization: 'a',
      cookie: 'a',
      authorizationCode: 'a',
      paystackAuthorizationCode: 'a',
      cardNumber: 'a',
      cvv: 'a',
      cvc: 'a',
      pin: 'a',
      secret: 'a',
      apiKey: 'a',
      privateKey: 'a',
      resetToken: 'a',
      otp: 'a',
    };
    const result = redactSensitive(input) as Record<string, string>;
    for (const key of Object.keys(input)) {
      expect(result[key]).toBe(REDACTED_PLACEHOLDER);
    }
  });
});
