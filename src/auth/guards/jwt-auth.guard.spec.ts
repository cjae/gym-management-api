import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ALLOW_WHILE_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-while-must-change-password.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let superCanActivate: jest.SpyInstance;

  const makeContext = (user?: {
    mustChangePassword?: boolean;
  }): ExecutionContext => {
    const request: { user?: typeof user } = user ? { user } : {};
    return {
      switchToHttp: () => ({ getRequest: () => request }) as any,
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
    // Stub the AuthGuard('jwt') parent so we control whether the JWT passes.
    superCanActivate = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    superCanActivate.mockRestore();
  });

  it('returns false when the parent JWT check fails', async () => {
    superCanActivate.mockResolvedValueOnce(false);
    const ctx = makeContext({ mustChangePassword: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
  });

  it('passes through when mustChangePassword is false', async () => {
    const ctx = makeContext({ mustChangePassword: false });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('passes through when mustChangePassword is undefined', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('blocks with ForbiddenException when mustChangePassword=true on a non-allowlisted route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = makeContext({ mustChangePassword: true });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Password change required. Please change your temporary password to continue.',
    );
  });

  it('allows when the route is decorated with @AllowWhileMustChangePassword()', async () => {
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(true);
    const ctx = makeContext({ mustChangePassword: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith(
      ALLOW_WHILE_MUST_CHANGE_PASSWORD_KEY,
      expect.any(Array),
    );
  });
});
