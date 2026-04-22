import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditLogService } from './audit-logs.service';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;

  const mockAuditLogService = {
    log: jest.fn().mockResolvedValue(undefined),
    fetchOldData: jest.fn().mockResolvedValue(null),
  };

  const mockReflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    interceptor = module.get<AuditInterceptor>(AuditInterceptor);
    jest.clearAllMocks();
    mockReflector.getAllAndOverride.mockReturnValue(false);
  });

  function createMockContext(overrides: {
    method?: string;
    user?: { id: string; email: string; role: string } | undefined;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    ip?: string;
    headers?: Record<string, string>;
    url?: string;
    controllerName?: string;
  }): ExecutionContext {
    const request = {
      method: overrides.method ?? 'POST',
      user:
        'user' in overrides
          ? overrides.user
          : { id: 'user-1', email: 'admin@test.com', role: 'ADMIN' },
      params: overrides.params ?? {},
      body: overrides.body ?? {},
      ip: overrides.ip ?? '127.0.0.1',
      headers: overrides.headers ?? { 'user-agent': 'Jest' },
      url: overrides.url ?? '/api/v1/users',
    };

    const controllerClass = {
      name: overrides.controllerName ?? 'UsersController',
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => controllerClass,
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(
    response: unknown = { id: 'new-1' },
  ): CallHandler {
    return {
      handle: () => of(response),
    };
  }

  it('should log POST requests by ADMIN users', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      body: { name: 'New User' },
      url: '/api/v1/users',
    });
    const handler = createMockCallHandler({ id: 'created-1' });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'CREATE',
        resource: 'User',
        newData: { id: 'created-1' },
        ipAddress: '127.0.0.1',
        userAgent: 'Jest',
        route: 'POST /api/v1/users',
        metadata: { requestBody: { name: 'New User' } },
      }),
    );
  });

  it('should log PATCH requests with old data (fetchOldData called)', async () => {
    const oldRecord = { id: 'user-2', name: 'Old Name' };
    mockAuditLogService.fetchOldData.mockResolvedValue(oldRecord);

    const context = createMockContext({
      method: 'PATCH',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      params: { id: 'user-2' },
      body: { name: 'New Name' },
      url: '/api/v1/users/user-2',
    });
    const handler = createMockCallHandler({ id: 'user-2', name: 'New Name' });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.fetchOldData).toHaveBeenCalledWith(
      'User',
      'user-2',
    );
    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        resource: 'User',
        resourceId: 'user-2',
        oldData: oldRecord,
        newData: { id: 'user-2', name: 'New Name' },
        metadata: { requestBody: { name: 'New Name' } },
      }),
    );
  });

  it('should log DELETE requests', async () => {
    const oldRecord = { id: 'user-3', name: 'To Delete' };
    mockAuditLogService.fetchOldData.mockResolvedValue(oldRecord);

    const context = createMockContext({
      method: 'DELETE',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      params: { id: 'user-3' },
      url: '/api/v1/users/user-3',
    });
    const handler = createMockCallHandler(undefined);

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.fetchOldData).toHaveBeenCalledWith(
      'User',
      'user-3',
    );
    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        resource: 'User',
        resourceId: 'user-3',
        oldData: oldRecord,
      }),
    );
  });

  it('should skip GET requests', async () => {
    const context = createMockContext({
      method: 'GET',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
    });
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('should skip MEMBER role users', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'member-1', email: 'member@test.com', role: 'MEMBER' },
    });
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('should skip TRAINER role users', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'trainer-1', email: 'trainer@test.com', role: 'TRAINER' },
    });
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('should skip unauthenticated requests', async () => {
    const context = createMockContext({
      method: 'POST',
      user: undefined,
    });
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('should skip routes with @NoAudit() decorator', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);

    const context = createMockContext({
      method: 'POST',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
    });
    const handler = createMockCallHandler();

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).not.toHaveBeenCalled();
  });

  it('should log SUPER_ADMIN actions', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'sa-1', email: 'superadmin@test.com', role: 'SUPER_ADMIN' },
      body: { amount: 50000 },
      url: '/api/v1/salary',
      controllerName: 'SalaryController',
    });
    const handler = createMockCallHandler({ id: 'sal-1', amount: 50000 });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'sa-1',
        action: 'CREATE',
        resource: 'Salary',
      }),
    );
  });

  it('should resolve GymClassesController to GymClasses resource', async () => {
    const oldRecord = { id: 'class-1', title: 'Morning HIIT' };
    mockAuditLogService.fetchOldData.mockResolvedValue(oldRecord);

    const context = createMockContext({
      method: 'PATCH',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      params: { id: 'class-1' },
      body: { title: 'Evening HIIT' },
      url: '/api/v1/gym-classes/class-1',
      controllerName: 'GymClassesController',
    });
    const handler = createMockCallHandler({
      id: 'class-1',
      title: 'Evening HIIT',
    });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.fetchOldData).toHaveBeenCalledWith(
      'GymClasses',
      'class-1',
    );
    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        resource: 'GymClasses',
        oldData: oldRecord,
      }),
    );
  });

  it('should redact password fields in audit metadata', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      body: { email: 'new@test.com', password: 'supersecret' },
      url: '/api/v1/auth/change-password',
    });
    const handler = createMockCallHandler({ ok: true });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          requestBody: { email: 'new@test.com', password: '[REDACTED]' },
        },
      }),
    );
  });

  it('should redact nested sensitive fields in audit metadata', async () => {
    const context = createMockContext({
      method: 'PATCH',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      params: { id: 'user-9' },
      body: {
        credentials: {
          currentPassword: 'old-pw',
          newPassword: 'new-pw',
        },
        displayName: 'Alice',
      },
      url: '/api/v1/users/user-9',
    });
    const handler = createMockCallHandler({ id: 'user-9' });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          requestBody: {
            credentials: {
              currentPassword: '[REDACTED]',
              newPassword: '[REDACTED]',
            },
            displayName: 'Alice',
          },
        },
      }),
    );
  });

  it('should redact sensitive keys inside arrays of objects', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      body: {
        users: [
          { id: '1', token: 'abc123', name: 'One' },
          { id: '2', token: 'def456', name: 'Two' },
        ],
      },
      url: '/api/v1/users/bulk',
    });
    const handler = createMockCallHandler({ count: 2 });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          requestBody: {
            users: [
              { id: '1', token: '[REDACTED]', name: 'One' },
              { id: '2', token: '[REDACTED]', name: 'Two' },
            ],
          },
        },
      }),
    );
  });

  it('should match sensitive keys case-insensitively', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      body: { Password: 'x', AccessToken: 'y', name: 'keep' },
      url: '/api/v1/users',
    });
    const handler = createMockCallHandler({ id: 'u-1' });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          requestBody: {
            Password: '[REDACTED]',
            AccessToken: '[REDACTED]',
            name: 'keep',
          },
        },
      }),
    );
  });

  it('should leave non-sensitive fields untouched in audit metadata', async () => {
    const context = createMockContext({
      method: 'POST',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
      body: { firstName: 'Alice', amount: 2500, active: true },
      url: '/api/v1/users',
    });
    const handler = createMockCallHandler({ id: 'u-1' });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(mockAuditLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          requestBody: {
            firstName: 'Alice',
            amount: 2500,
            active: true,
          },
        },
      }),
    );
  });

  it('should not fail the request if audit logging throws', async () => {
    mockAuditLogService.log.mockRejectedValue(new Error('Audit DB down'));

    const context = createMockContext({
      method: 'POST',
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' },
    });
    const responseData = { id: 'created-1' };
    const handler = createMockCallHandler(responseData);

    const result$ = await interceptor.intercept(context, handler);
    const result = await lastValueFrom(result$);

    expect(result).toEqual(responseData);
  });
});
