// Deep-redacts known-sensitive keys before data is persisted to diagnostic
// pipelines (audit log metadata, error trackers, etc.). Matching is
// case-insensitive; keys are normalized to lowercase before comparison.
//
// Returns a NEW structure — never mutates inputs. Non-plain values (Date,
// primitives, null) pass through unchanged. Arrays of objects are recursed
// element-by-element.

const REDACTED_KEYS: ReadonlySet<string> = new Set(
  [
    'password',
    'currentPassword',
    'newPassword',
    'confirmPassword',
    'oldPassword',
    'token',
    'refreshToken',
    'accessToken',
    'authorization',
    'cookie',
    'authorizationCode',
    'paystackAuthorizationCode',
    'cardNumber',
    'cvv',
    'cvc',
    'pin',
    'secret',
    'apiKey',
    'privateKey',
    'resetToken',
    'otp',
  ].map((k) => k.toLowerCase()),
);

export const REDACTED_PLACEHOLDER = '[REDACTED]';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  !(v instanceof Date) &&
  Object.getPrototypeOf(v) === Object.prototype;

export function redactSensitive<T>(value: T, seen = new WeakSet()): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen)) as unknown as T;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[Circular]' as unknown as T;
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        result[key] = REDACTED_PLACEHOLDER;
      } else {
        result[key] = redactSensitive(val, seen);
      }
    }
    return result as T;
  }
  // Dates, primitives, null, class instances: return as-is.
  return value;
}
