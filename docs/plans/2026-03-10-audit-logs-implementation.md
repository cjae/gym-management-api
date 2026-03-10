# Audit Logs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add audit logging that automatically captures admin/super-admin write operations and auth events, with a SUPER_ADMIN-only query endpoint.

**Architecture:** Global NestJS interceptor auto-detects POST/PUT/PATCH/DELETE by ADMIN/SUPER_ADMIN users. Auth events logged explicitly in AuthService. AuditLog stored in PostgreSQL via Prisma. Single GET endpoint for SUPER_ADMIN to query logs.

**Tech Stack:** NestJS interceptor, Prisma 6, class-validator DTOs, Jest unit tests

---

### Task 1: Prisma Schema — AuditLog model and enum

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add AuditAction enum and AuditLog model to schema**

Add after the `Gender` enum (line 60):

```prisma
enum AuditAction {
  CREATE
  UPDATE
  DELETE
  LOGIN
  LOGIN_FAILED
  LOGOUT
  PASSWORD_RESET_REQUEST
  PASSWORD_RESET
  PASSWORD_CHANGE
}
```

Add after the `LicenseCache` model (end of file):

```prisma
model AuditLog {
  id         String      @id @default(uuid())
  userId     String?
  action     AuditAction
  resource   String
  resourceId String?
  oldData    Json?
  newData    Json?
  ipAddress  String?
  userAgent  String?
  route      String?
  metadata   Json?
  createdAt  DateTime    @default(now())

  user User? @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([resource, resourceId])
  @@index([action])
  @@index([createdAt])
}
```

Add to the `User` model relations (after `passwordResetTokens` on line 86):

```prisma
  auditLogs           AuditLog[]
```

**Step 2: Generate migration**

Run: `npx prisma migrate dev --name add-audit-log`
Expected: Migration created and applied successfully

**Step 3: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add AuditLog model and AuditAction enum"
```

---

### Task 2: AuditLog Service with unit tests

**Files:**
- Create: `src/audit-logs/audit-logs.service.ts`
- Create: `src/audit-logs/audit-logs.service.spec.ts`

**Step 1: Write the failing test**

Create `src/audit-logs/audit-logs.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: typeof mockPrisma;

  const mockPrisma = {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    subscriptionPlan: { findUnique: jest.fn() },
    memberSubscription: { findUnique: jest.fn() },
    staffSalaryRecord: { findUnique: jest.fn() },
    trainerProfile: { findUnique: jest.fn() },
    legalDocument: { findUnique: jest.fn() },
    entrance: { findUnique: jest.fn() },
    gymQrCode: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    prisma = mockPrisma;
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.log({
        userId: 'user-1',
        action: 'CREATE',
        resource: 'User',
        resourceId: 'user-2',
        newData: { email: 'test@test.com', firstName: 'Test' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        route: 'POST /api/v1/users',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'CREATE',
          resource: 'User',
          resourceId: 'user-2',
        }),
      });
    });

    it('should strip sensitive fields from oldData and newData', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.log({
        userId: 'user-1',
        action: 'UPDATE',
        resource: 'User',
        resourceId: 'user-2',
        oldData: { email: 'old@test.com', password: 'hashed-pw' },
        newData: { email: 'new@test.com', password: 'new-hashed-pw', paystackAuthorizationCode: 'auth-code' },
        ipAddress: '127.0.0.1',
        route: 'PATCH /api/v1/users/user-2',
      });

      const createCall = prisma.auditLog.create.mock.calls[0][0];
      expect(createCall.data.oldData).not.toHaveProperty('password');
      expect(createCall.data.newData).not.toHaveProperty('password');
      expect(createCall.data.newData).not.toHaveProperty('paystackAuthorizationCode');
    });

    it('should allow null userId for failed logins', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

      await service.log({
        userId: null,
        action: 'LOGIN_FAILED',
        resource: 'Auth',
        metadata: { email: 'unknown@test.com' },
        ipAddress: '127.0.0.1',
        route: 'POST /api/v1/auth/login',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          action: 'LOGIN_FAILED',
        }),
      });
    });
  });

  describe('fetchOldData', () => {
    it('should fetch existing user data', async () => {
      const userData = { id: 'user-1', email: 'test@test.com', firstName: 'Test' };
      mockPrisma.user.findUnique.mockResolvedValue(userData);

      const result = await service.fetchOldData('User', 'user-1');

      expect(result).toEqual(userData);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('should return null for unknown resource type', async () => {
      const result = await service.fetchOldData('Unknown', 'some-id');
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return paginated audit logs', async () => {
      const logs = [
        { id: 'log-1', action: 'CREATE', resource: 'User', createdAt: new Date(), user: { id: 'u1', email: 'admin@gym.co.ke', firstName: 'Admin', lastName: 'User' } },
      ];
      mockPrisma.auditLog.findMany.mockResolvedValue(logs);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toEqual(logs);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('should apply filters', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        limit: 20,
        userId: 'user-1',
        action: 'CREATE',
        resource: 'User',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            action: 'CREATE',
            resource: 'User',
          }),
        }),
      );
    });

    it('should apply date range filter', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      const startDate = '2026-03-01';
      const endDate = '2026-03-10';

      await service.findAll({ page: 1, limit: 20, startDate, endDate });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date(startDate),
              lte: new Date(endDate),
            },
          }),
        }),
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=audit-logs.service`
Expected: FAIL — cannot find module `./audit-logs.service`

**Step 3: Write the service implementation**

Create `src/audit-logs/audit-logs.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

const SENSITIVE_FIELDS = [
  'password',
  'paystackAuthorizationCode',
  'token',
  'signatureData',
];

interface LogEntry {
  userId: string | null;
  action: string;
  resource: string;
  resourceId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  route?: string;
  metadata?: Record<string, unknown>;
}

interface FindAllParams {
  page: number;
  limit: number;
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  ipAddress?: string;
}

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async log(entry: LogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action as AuditAction,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        oldData: entry.oldData ? this.stripSensitive(entry.oldData) : null,
        newData: entry.newData ? this.stripSensitive(entry.newData) : null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        route: entry.route ?? null,
        metadata: entry.metadata ?? null,
      },
    });
  }

  async fetchOldData(resource: string, id: string): Promise<Record<string, unknown> | null> {
    const modelMap: Record<string, { findUnique: (args: { where: { id: string } }) => Promise<unknown> }> = {
      User: this.prisma.user,
      SubscriptionPlan: this.prisma.subscriptionPlan,
      Subscription: this.prisma.memberSubscription,
      Salary: this.prisma.staffSalaryRecord,
      Trainer: this.prisma.trainerProfile,
      Legal: this.prisma.legalDocument,
      Entrance: this.prisma.entrance,
      QrCode: this.prisma.gymQrCode,
    };

    const model = modelMap[resource];
    if (!model) return null;

    const record = await model.findUnique({ where: { id } });
    return record as Record<string, unknown> | null;
  }

  async findAll(params: FindAllParams) {
    const { page, limit, userId, action, resource, resourceId, startDate, endDate, ipAddress } = params;

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (resourceId) where.resourceId = resourceId;
    if (ipAddress) where.ipAddress = ipAddress;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private stripSensitive(data: Record<string, unknown>): Record<string, unknown> {
    const cleaned = { ...data };
    for (const field of SENSITIVE_FIELDS) {
      delete cleaned[field];
    }
    return cleaned;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=audit-logs.service`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add src/audit-logs/
git commit -m "feat(audit-logs): add AuditLogService with unit tests"
```

---

### Task 3: NoAudit decorator

**Files:**
- Create: `src/audit-logs/decorators/no-audit.decorator.ts`

**Step 1: Create the decorator**

```typescript
import { SetMetadata } from '@nestjs/common';

export const NO_AUDIT_KEY = 'no-audit';
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
```

**Step 2: Commit**

```bash
git add src/audit-logs/decorators/
git commit -m "feat(audit-logs): add @NoAudit() opt-out decorator"
```

---

### Task 4: Audit interceptor with unit tests

**Files:**
- Create: `src/audit-logs/audit.interceptor.ts`
- Create: `src/audit-logs/audit.interceptor.spec.ts`

**Step 1: Write the failing test**

Create `src/audit-logs/audit.interceptor.spec.ts`:

```typescript
import { AuditInterceptor } from './audit.interceptor';
import { AuditLogService } from './audit-logs.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let auditLogService: { log: jest.Mock; fetchOldData: jest.Mock };
  let reflector: { get: jest.Mock };

  beforeEach(() => {
    auditLogService = {
      log: jest.fn().mockResolvedValue(undefined),
      fetchOldData: jest.fn().mockResolvedValue(null),
    };
    reflector = { get: jest.fn().mockReturnValue(false) };
    interceptor = new AuditInterceptor(
      auditLogService as unknown as AuditLogService,
      reflector as unknown as Reflector,
    );
    jest.clearAllMocks();
  });

  function createMockContext(overrides: {
    method?: string;
    url?: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    user?: { sub: string; email: string; role: string } | undefined;
    ip?: string;
    userAgent?: string;
    controllerName?: string;
  }): ExecutionContext {
    const request = {
      method: overrides.method ?? 'POST',
      url: overrides.url ?? '/api/v1/users',
      params: overrides.params ?? {},
      body: overrides.body ?? {},
      user: overrides.user ?? { sub: 'admin-1', email: 'admin@gym.co.ke', role: 'ADMIN' },
      ip: overrides.ip ?? '127.0.0.1',
      headers: { 'user-agent': overrides.userAgent ?? 'test-agent' },
    };

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({ name: overrides.controllerName ?? 'UsersController' }),
    } as unknown as ExecutionContext;
  }

  const mockCallHandler: CallHandler = { handle: () => of({ id: 'new-1', email: 'test@test.com' }) };

  it('should log POST requests by ADMIN users', (done) => {
    const ctx = createMockContext({ method: 'POST', body: { email: 'test@test.com' } });

    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          action: 'CREATE',
          resource: 'User',
        }),
      );
      done();
    });
  });

  it('should log PATCH requests with old data', (done) => {
    auditLogService.fetchOldData.mockResolvedValue({ id: 'user-2', email: 'old@test.com' });
    const ctx = createMockContext({
      method: 'PATCH',
      params: { id: 'user-2' },
      body: { email: 'new@test.com' },
    });

    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.fetchOldData).toHaveBeenCalledWith('User', 'user-2');
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          oldData: { id: 'user-2', email: 'old@test.com' },
        }),
      );
      done();
    });
  });

  it('should log DELETE requests', (done) => {
    auditLogService.fetchOldData.mockResolvedValue({ id: 'user-2', email: 'deleted@test.com' });
    const ctx = createMockContext({ method: 'DELETE', params: { id: 'user-2' } });

    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE' }),
      );
      done();
    });
  });

  it('should skip GET requests', (done) => {
    const ctx = createMockContext({ method: 'GET' });
    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('should skip MEMBER role users', (done) => {
    const ctx = createMockContext({
      method: 'POST',
      user: { sub: 'member-1', email: 'member@test.com', role: 'MEMBER' },
    });

    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('should skip TRAINER role users', (done) => {
    const ctx = createMockContext({
      method: 'POST',
      user: { sub: 'trainer-1', email: 'trainer@test.com', role: 'TRAINER' },
    });

    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('should skip unauthenticated requests', (done) => {
    const ctx = createMockContext({ method: 'POST', user: undefined });
    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('should skip routes with @NoAudit() decorator', (done) => {
    reflector.get.mockReturnValue(true);
    const ctx = createMockContext({ method: 'POST' });

    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('should log SUPER_ADMIN actions', (done) => {
    const ctx = createMockContext({
      method: 'PATCH',
      params: { id: 'user-2' },
      user: { sub: 'sa-1', email: 'super@gym.co.ke', role: 'SUPER_ADMIN' },
    });

    interceptor.intercept(ctx, mockCallHandler).subscribe(() => {
      expect(auditLogService.log).toHaveBeenCalled();
      done();
    });
  });

  it('should not fail the request if audit logging throws', (done) => {
    auditLogService.log.mockRejectedValue(new Error('DB error'));
    const ctx = createMockContext({ method: 'POST' });

    interceptor.intercept(ctx, mockCallHandler).subscribe({
      next: (value) => {
        // Request should still succeed
        expect(value).toEqual({ id: 'new-1', email: 'test@test.com' });
        done();
      },
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=audit.interceptor`
Expected: FAIL — cannot find module `./audit.interceptor`

**Step 3: Write the interceptor implementation**

Create `src/audit-logs/audit.interceptor.ts`:

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditLogService } from './audit-logs.service';
import { NO_AUDIT_KEY } from './decorators/no-audit.decorator';

interface JwtUser {
  sub: string;
  email: string;
  role: string;
}

interface AuditRequest {
  method: string;
  url: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
  user?: JwtUser;
  ip: string;
  headers: Record<string, string>;
}

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUDITED_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

const CONTROLLER_TO_RESOURCE: Record<string, string> = {
  UsersController: 'User',
  SubscriptionPlansController: 'SubscriptionPlan',
  SubscriptionsController: 'Subscription',
  PaymentsController: 'Payment',
  AttendanceController: 'Attendance',
  TrainersController: 'Trainer',
  LegalController: 'Legal',
  SalaryController: 'Salary',
  EntrancesController: 'Entrance',
  QrController: 'QrCode',
  BillingController: 'Billing',
  UploadsController: 'Upload',
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditRequest>();
    const { method, user } = request;

    // Skip if not a write method, not an audited role, or opted out
    if (!AUDITED_METHODS.has(method)) return next.handle();
    if (!user || !AUDITED_ROLES.has(user.role)) return next.handle();

    const noAudit = this.reflector.get<boolean>(NO_AUDIT_KEY, context.getHandler());
    if (noAudit) return next.handle();

    const action = METHOD_TO_ACTION[method];
    const controllerName = context.getClass().name;
    const resource = CONTROLLER_TO_RESOURCE[controllerName] ?? controllerName.replace('Controller', '');
    const resourceId = request.params.id;

    // Fetch old data before mutation for UPDATE/DELETE
    const oldDataPromise =
      (action === 'UPDATE' || action === 'DELETE') && resourceId
        ? this.auditLogService.fetchOldData(resource, resourceId)
        : Promise.resolve(null);

    return new Observable((subscriber) => {
      oldDataPromise
        .then((oldData) => {
          next
            .handle()
            .pipe(
              tap((responseBody) => {
                const entry = {
                  userId: user.sub,
                  action,
                  resource,
                  resourceId: resourceId ?? null,
                  oldData: oldData as Record<string, unknown> | undefined,
                  newData: (action === 'DELETE' ? undefined : responseBody) as Record<string, unknown> | undefined,
                  ipAddress: request.ip,
                  userAgent: request.headers['user-agent'],
                  route: `${method} ${request.url}`,
                };

                this.auditLogService.log(entry).catch((err) => {
                  this.logger.error('Failed to write audit log', err);
                });
              }),
            )
            .subscribe(subscriber);
        })
        .catch(() => {
          // If old data fetch fails, still proceed with request
          next.handle().subscribe(subscriber);
        });
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=audit.interceptor`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add src/audit-logs/
git commit -m "feat(audit-logs): add AuditInterceptor with unit tests"
```

---

### Task 5: DTOs for audit log query endpoint

**Files:**
- Create: `src/audit-logs/dto/audit-log-query.dto.ts`
- Create: `src/audit-logs/dto/audit-log-response.dto.ts`

**Step 1: Create the query DTO**

Create `src/audit-logs/dto/audit-log-query.dto.ts`:

```typescript
import { IsEnum, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';
import { AuditAction } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class AuditLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsString()
  resource?: string;

  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;
}
```

**Step 2: Create the response DTO**

Create `src/audit-logs/dto/audit-log-response.dto.ts`:

```typescript
import { AuditAction } from '@prisma/client';

class AuditLogUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export class AuditLogResponseDto {
  id: string;
  userId: string | null;
  action: AuditAction;
  resource: string;
  resourceId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  route: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  user: AuditLogUserDto | null;
}

class PaginationMetaDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class PaginatedAuditLogResponseDto {
  data: AuditLogResponseDto[];
  meta: PaginationMetaDto;
}
```

**Step 3: Commit**

```bash
git add src/audit-logs/dto/
git commit -m "feat(audit-logs): add query and response DTOs"
```

---

### Task 6: AuditLog Controller with unit tests

**Files:**
- Create: `src/audit-logs/audit-logs.controller.ts`
- Create: `src/audit-logs/audit-logs.controller.spec.ts`

**Step 1: Write the failing test**

Create `src/audit-logs/audit-logs.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogController } from './audit-logs.controller';
import { AuditLogService } from './audit-logs.service';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let service: { findAll: jest.Mock };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [{ provide: AuditLogService, useValue: service }],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated audit logs', async () => {
      const expected = {
        data: [{ id: 'log-1', action: 'CREATE', resource: 'User' }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });

    it('should pass filters to service', async () => {
      service.findAll.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });

      await controller.findAll({ page: 1, limit: 20, action: 'LOGIN' as any, resource: 'Auth' });

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGIN', resource: 'Auth' }),
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=audit-logs.controller`
Expected: FAIL — cannot find module `./audit-logs.controller`

**Step 3: Write the controller**

Create `src/audit-logs/audit-logs.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { AuditLogService } from './audit-logs.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { PaginatedAuditLogResponseDto } from './dto/audit-log-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOkResponse({ type: PaginatedAuditLogResponseDto, description: 'Paginated audit logs' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogService.findAll(query);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=audit-logs.controller`
Expected: All 2 tests PASS

**Step 5: Commit**

```bash
git add src/audit-logs/
git commit -m "feat(audit-logs): add AuditLogController (SUPER_ADMIN only)"
```

---

### Task 7: AuditLog Module and AppModule registration

**Files:**
- Create: `src/audit-logs/audit-logs.module.ts`
- Modify: `src/app.module.ts:1-76`

**Step 1: Create the module**

Create `src/audit-logs/audit-logs.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogService } from './audit-logs.service';
import { AuditLogController } from './audit-logs.controller';
import { AuditInterceptor } from './audit.interceptor';

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
```

**Step 2: Register in AppModule**

In `src/app.module.ts`, add the import:

```typescript
import { AuditLogModule } from './audit-logs/audit-logs.module';
```

Add `AuditLogModule` to the `imports` array (after `UploadsModule`).

**Step 3: Run all tests to verify nothing breaks**

Run: `yarn test`
Expected: All tests PASS (existing + new audit log tests)

**Step 4: Commit**

```bash
git add src/audit-logs/audit-logs.module.ts src/app.module.ts
git commit -m "feat(audit-logs): register AuditLogModule globally in AppModule"
```

---

### Task 8: Auth event logging in AuthService

**Files:**
- Modify: `src/auth/auth.service.ts:1-276`
- Modify: `src/auth/auth.service.spec.ts:1-505`

**Step 1: Add AuditLogService to AuthService constructor**

In `src/auth/auth.service.ts`, add the import:

```typescript
import { AuditLogService } from '../audit-logs/audit-logs.service';
```

Add to constructor:

```typescript
constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly licensingService: LicensingService,
    private readonly auditLogService: AuditLogService,
  ) {}
```

**Step 2: Add audit logging to login method**

After the successful `generateTokens` call in `login()` (line 84), and for failed login attempts. Replace the `login` method:

```typescript
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      this.auditLogService.log({
        userId: null,
        action: 'LOGIN_FAILED',
        resource: 'Auth',
        ipAddress,
        userAgent,
        route: 'POST /api/v1/auth/login',
        metadata: { email: dto.email },
      }).catch(() => {});
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      this.auditLogService.log({
        userId: user.id,
        action: 'LOGIN_FAILED',
        resource: 'Auth',
        ipAddress,
        userAgent,
        route: 'POST /api/v1/auth/login',
        metadata: { email: dto.email },
      }).catch(() => {});
      throw new UnauthorizedException('Invalid credentials');
    }

    this.auditLogService.log({
      userId: user.id,
      action: 'LOGIN',
      resource: 'Auth',
      ipAddress,
      userAgent,
      route: 'POST /api/v1/auth/login',
    }).catch(() => {});

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.mustChangePassword,
    );
  }
```

**Step 3: Add audit logging to logout method**

Replace the `logout` method:

```typescript
  async logout(jti: string, userId?: string, ipAddress?: string, userAgent?: string) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.invalidatedToken.create({
      data: { jti, expiresAt },
    });

    if (userId) {
      this.auditLogService.log({
        userId,
        action: 'LOGOUT',
        resource: 'Auth',
        ipAddress,
        userAgent,
        route: 'POST /api/v1/auth/logout',
      }).catch(() => {});
    }

    return { message: 'Logged out successfully.' };
  }
```

**Step 4: Add audit logging to forgotPassword method**

After the email is sent in `forgotPassword()`, add:

```typescript
    this.auditLogService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUEST',
      resource: 'Auth',
      route: 'POST /api/v1/auth/forgot-password',
      metadata: { email: dto.email },
    }).catch(() => {});
```

Add this just before the `return` statement at the end (line 155).

**Step 5: Add audit logging to resetPassword method**

After the `$transaction` call in `resetPassword()`, add:

```typescript
    this.auditLogService.log({
      userId: resetToken.userId,
      action: 'PASSWORD_RESET',
      resource: 'Auth',
      route: 'POST /api/v1/auth/reset-password',
    }).catch(() => {});
```

Add before the `return` statement (line 187).

**Step 6: Add audit logging to changePassword method**

After the `prisma.user.update` call in `changePassword()`, add:

```typescript
    this.auditLogService.log({
      userId,
      action: 'PASSWORD_CHANGE',
      resource: 'Auth',
      route: 'PATCH /api/v1/auth/change-password',
    }).catch(() => {});
```

Add before the `return` statement (line 209).

**Step 7: Update AuthController to pass IP and user-agent**

In `src/auth/auth.controller.ts`, update the `login` method to pass request info:

```typescript
import { Controller, Post, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
```

Update `login`:

```typescript
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip, req.headers['user-agent']);
  }
```

Update `logout`:

```typescript
  logout(
    @CurrentUser('jti') jti: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.authService.logout(jti, userId, req.ip, req.headers['user-agent']);
  }
```

**Step 8: Update auth tests to include mock AuditLogService**

In `src/auth/auth.service.spec.ts`, add to providers:

```typescript
const mockAuditLogService = {
  log: jest.fn().mockResolvedValue(undefined),
};
```

Add to the `providers` array:

```typescript
{ provide: AuditLogService, useValue: mockAuditLogService },
```

Add the import:

```typescript
import { AuditLogService } from '../audit-logs/audit-logs.service';
```

Update the `login` test calls to pass the extra params (or leave them as `undefined` — they're optional).

Update the `logout` test to pass extra params.

**Step 9: Run all tests**

Run: `yarn test`
Expected: All tests PASS

**Step 10: Commit**

```bash
git add src/auth/ src/audit-logs/
git commit -m "feat(audit-logs): add auth event logging (login, logout, password reset/change)"
```

---

### Task 9: Update CLAUDE.md and final verification

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add audit-logs module to CLAUDE.md**

In the **Modules** section, add:
```
- `audit-logs/` — Audit logging for admin actions and auth events. Global interceptor auto-logs write operations by ADMIN/SUPER_ADMIN. Auth events logged explicitly. SUPER_ADMIN-only query endpoint.
```

**Step 2: Run full test suite**

Run: `yarn test`
Expected: All tests PASS

**Step 3: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add audit-logs module to CLAUDE.md"
```
