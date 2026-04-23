import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import * as Sentry from '@sentry/nestjs';
import { SentryUserInterceptor } from './sentry-user.interceptor';

jest.mock('@sentry/nestjs', () => ({
  setUser: jest.fn(),
}));

describe('SentryUserInterceptor', () => {
  let interceptor: SentryUserInterceptor;
  const setUserMock = Sentry.setUser as jest.Mock;

  beforeEach(() => {
    interceptor = new SentryUserInterceptor();
    setUserMock.mockClear();
  });

  function createContext(user: unknown): ExecutionContext {
    const request = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  const handler: CallHandler = { handle: () => of('ok') };

  it('sets Sentry user with only id and role (no PII fields)', async () => {
    const ctx = createContext({
      id: 'user-1',
      email: 'alice@example.com',
      role: 'ADMIN',
      jti: 'token-jti-abc',
      mustChangePassword: false,
    });

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(setUserMock).toHaveBeenCalledTimes(1);
    const payload = setUserMock.mock.calls[0][0];
    expect(payload).toEqual({ id: 'user-1', role: 'ADMIN' });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('username');
    expect(payload).not.toHaveProperty('jti');
    expect(payload).not.toHaveProperty('mustChangePassword');
  });

  it('does not call setUser when request has no user', async () => {
    const ctx = createContext(undefined);

    await lastValueFrom(interceptor.intercept(ctx, handler));

    expect(setUserMock).not.toHaveBeenCalled();
  });

  it('forwards the handler response unchanged', async () => {
    const ctx = createContext({
      id: 'user-1',
      role: 'MEMBER',
      email: 'bob@example.com',
      jti: 'jti-1',
      mustChangePassword: false,
    });
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBe('ok');
  });
});
