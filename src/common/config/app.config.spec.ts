import { getAppConfig } from './app.config';

describe('getAppConfig', () => {
  const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;

  afterEach(() => {
    if (originalTrustProxyHops === undefined) {
      delete process.env.TRUST_PROXY_HOPS;
    } else {
      process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
    }
  });

  it('defaults trustProxyHops to 1 when TRUST_PROXY_HOPS is unset', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(getAppConfig().trustProxyHops).toBe(1);
  });

  it('parses TRUST_PROXY_HOPS when set', () => {
    process.env.TRUST_PROXY_HOPS = '2';
    expect(getAppConfig().trustProxyHops).toBe(2);
  });

  it('accepts 0 (direct deploy, no proxy)', () => {
    process.env.TRUST_PROXY_HOPS = '0';
    expect(getAppConfig().trustProxyHops).toBe(0);
  });

  it('falls back to 1 on non-numeric input', () => {
    process.env.TRUST_PROXY_HOPS = 'not-a-number';
    expect(getAppConfig().trustProxyHops).toBe(1);
  });

  it('falls back to 1 on negative input', () => {
    process.env.TRUST_PROXY_HOPS = '-3';
    expect(getAppConfig().trustProxyHops).toBe(1);
  });
});
