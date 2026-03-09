# SaaS Licensing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add license key phone-home validation so each gym deployment can be remotely disabled when the gym stops paying.

**Architecture:** A `licensing/` module with a global guard that blocks all requests when the license is invalid. A daily cron job phones home to validate the license. License state is cached in a `LicenseCache` DB table with a 7-day grace period.

**Tech Stack:** NestJS, Prisma, Axios (already installed), `@nestjs/schedule` (already configured)

---

### Task 1: Database Schema — LicenseCache Model

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add LicenseStatus enum and LicenseCache model to schema**

Add at the end of `prisma/schema.prisma`:

```prisma
enum LicenseStatus {
  ACTIVE
  SUSPENDED
  EXPIRED
}

model LicenseCache {
  id            String        @id @default("singleton")
  licenseKey    String
  status        LicenseStatus @default(ACTIVE)
  gymName       String?
  tierName      String?
  maxMembers    Int?
  expiresAt     DateTime?
  lastCheckedAt DateTime?
  lastSuccessAt DateTime?
  rawResponse   Json?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}
```

**Step 2: Generate migration**

Run: `npx prisma migrate dev --name add-license-cache`
Expected: Migration created and applied successfully.

**Step 3: Commit**

```bash
git add prisma/
git commit -m "feat(licensing): add LicenseCache schema and migration"
```

---

### Task 2: Licensing Config

**Files:**
- Create: `src/licensing/licensing.config.ts`
- Modify: `src/common/loaders/config.loader.module.ts`

**Step 1: Create the config factory**

Create `src/licensing/licensing.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';

export type LicensingConfig = {
  licenseKey: string;
  licenseServerUrl: string;
};

export const getLicensingConfigName = () => 'licensing';

export const getLicensingConfig = (): LicensingConfig => ({
  licenseKey: process.env.LICENSE_KEY ?? '',
  licenseServerUrl: process.env.LICENSE_SERVER_URL ?? '',
});

export default registerAs(getLicensingConfigName(), getLicensingConfig);
```

**Step 2: Register in ConfigLoaderModule**

In `src/common/loaders/config.loader.module.ts`, add the import:

```typescript
import licensingConfig from '../../licensing/licensing.config';
```

And add `licensingConfig` to the `load` array:

```typescript
load: [
  appConfig,
  authConfig,
  mailConfig,
  paymentConfig,
  sentryConfig,
  cloudinaryConfig,
  licensingConfig,
],
```

**Step 3: Commit**

```bash
git add src/licensing/licensing.config.ts src/common/loaders/config.loader.module.ts
git commit -m "feat(licensing): add licensing config factory"
```

---

### Task 3: License Response DTO

**Files:**
- Create: `src/licensing/dto/license-response.dto.ts`

**Step 1: Create the DTO**

Create `src/licensing/dto/license-response.dto.ts`:

```typescript
export class LicenseResponseDto {
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  gymName?: string;
  tierName?: string;
  maxMembers?: number;
  expiresAt?: string;
}
```

**Step 2: Commit**

```bash
git add src/licensing/dto/license-response.dto.ts
git commit -m "feat(licensing): add license response DTO"
```

---

### Task 4: LicenseService — Core Logic

**Files:**
- Create: `src/licensing/licensing.service.spec.ts`
- Create: `src/licensing/licensing.service.ts`

**Step 1: Write the failing tests**

Create `src/licensing/licensing.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('LicensingService', () => {
  let service: LicensingService;
  let prisma: PrismaService;

  const mockPrisma = {
    licenseCache: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({
      licenseKey: 'test-license-key',
      licenseServerUrl: 'https://license.example.com',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicensingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LicensingService>(LicensingService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('isActive', () => {
    it('should return true when no LICENSE_KEY is configured (dev mode)', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: '',
        licenseServerUrl: '',
      });
      const devService = new LicensingService(
        mockPrisma as any,
        mockConfigService as any,
      );
      const result = await devService.isActive();
      expect(result).toBe(true);
    });

    it('should return true when cached status is ACTIVE', async () => {
      mockPrisma.licenseCache.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        lastSuccessAt: new Date(),
      });
      const result = await service.isActive();
      expect(result).toBe(true);
    });

    it('should return true when SUSPENDED but within grace period', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      mockPrisma.licenseCache.findUnique.mockResolvedValue({
        status: 'SUSPENDED',
        lastSuccessAt: threeDaysAgo,
      });
      const result = await service.isActive();
      expect(result).toBe(true);
    });

    it('should return false when SUSPENDED and grace period exceeded', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      mockPrisma.licenseCache.findUnique.mockResolvedValue({
        status: 'SUSPENDED',
        lastSuccessAt: tenDaysAgo,
      });
      const result = await service.isActive();
      expect(result).toBe(false);
    });

    it('should return true when no cache exists (first run)', async () => {
      mockPrisma.licenseCache.findUnique.mockResolvedValue(null);
      const result = await service.isActive();
      expect(result).toBe(true);
    });
  });

  describe('validateLicense', () => {
    it('should update cache with ACTIVE on successful response', async () => {
      mockPrisma.user.count.mockResolvedValue(25);
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: {
          status: 'ACTIVE',
          gymName: 'Test Gym',
          tierName: 'Growth',
          maxMembers: 100,
          expiresAt: '2026-04-10T00:00:00Z',
        },
      });
      mockPrisma.licenseCache.upsert.mockResolvedValue({});

      await service.validateLicense();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://license.example.com/api/v1/licenses/validate',
        expect.objectContaining({ currentMemberCount: 25 }),
        expect.objectContaining({
          headers: { 'X-License-Key': 'test-license-key' },
        }),
      );
      expect(mockPrisma.licenseCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton' },
          update: expect.objectContaining({ status: 'ACTIVE' }),
          create: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('should set SUSPENDED on 403 response', async () => {
      mockPrisma.user.count.mockResolvedValue(25);
      const error = {
        isAxiosError: true,
        response: { status: 403 },
      };
      mockedAxios.post.mockRejectedValue(error);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockPrisma.licenseCache.upsert.mockResolvedValue({});

      await service.validateLicense();

      expect(mockPrisma.licenseCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'SUSPENDED' }),
        }),
      );
    });

    it('should not change status on network error', async () => {
      mockPrisma.user.count.mockResolvedValue(25);
      const error = {
        isAxiosError: true,
        response: undefined,
      };
      mockedAxios.post.mockRejectedValue(error);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await service.validateLicense();

      // Should only update lastCheckedAt, not upsert with new status
      expect(mockPrisma.licenseCache.upsert).not.toHaveBeenCalled();
    });

    it('should skip validation when LICENSE_KEY is not set', async () => {
      mockConfigService.get.mockReturnValue({
        licenseKey: '',
        licenseServerUrl: '',
      });
      const devService = new LicensingService(
        mockPrisma as any,
        mockConfigService as any,
      );

      await devService.validateLicense();

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('getMemberLimit', () => {
    it('should return maxMembers from cached license', async () => {
      mockPrisma.licenseCache.findUnique.mockResolvedValue({
        maxMembers: 100,
      });
      const result = await service.getMemberLimit();
      expect(result).toBe(100);
    });

    it('should return null when no cache exists', async () => {
      mockPrisma.licenseCache.findUnique.mockResolvedValue(null);
      const result = await service.getMemberLimit();
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=licensing.service`
Expected: FAIL — `Cannot find module './licensing.service'`

**Step 3: Write the LicenseService implementation**

Create `src/licensing/licensing.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  LicensingConfig,
  getLicensingConfigName,
} from './licensing.config';
import { LicenseResponseDto } from './dto/license-response.dto';
import axios from 'axios';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);
  private readonly licenseKey: string;
  private readonly licenseServerUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const config =
      this.configService.get<LicensingConfig>(getLicensingConfigName())!;
    this.licenseKey = config.licenseKey;
    this.licenseServerUrl = config.licenseServerUrl;
  }

  private isConfigured(): boolean {
    return !!(this.licenseKey && this.licenseServerUrl);
  }

  async isActive(): Promise<boolean> {
    if (!this.isConfigured()) return true;

    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });

    if (!cache) return true; // First run, not yet validated

    if (cache.status === 'ACTIVE') return true;

    // SUSPENDED or EXPIRED — check grace period
    if (cache.lastSuccessAt) {
      const elapsed = Date.now() - cache.lastSuccessAt.getTime();
      return elapsed <= GRACE_PERIOD_MS;
    }

    return false;
  }

  async validateLicense(): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug('No LICENSE_KEY configured, skipping validation');
      return;
    }

    const now = new Date();
    const memberCount = await this.prisma.user.count({
      where: { role: 'MEMBER' },
    });

    try {
      const response = await axios.post<LicenseResponseDto>(
        `${this.licenseServerUrl}/api/v1/licenses/validate`,
        {
          currentMemberCount: memberCount,
          appVersion: '1.0.0',
        },
        {
          headers: { 'X-License-Key': this.licenseKey },
          timeout: 10000,
        },
      );

      const data = response.data;

      await this.prisma.licenseCache.upsert({
        where: { id: 'singleton' },
        update: {
          licenseKey: this.licenseKey,
          status: data.status,
          gymName: data.gymName,
          tierName: data.tierName,
          maxMembers: data.maxMembers,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          lastCheckedAt: now,
          lastSuccessAt: now,
          rawResponse: data as any,
        },
        create: {
          id: 'singleton',
          licenseKey: this.licenseKey,
          status: data.status,
          gymName: data.gymName,
          tierName: data.tierName,
          maxMembers: data.maxMembers,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          lastCheckedAt: now,
          lastSuccessAt: now,
          rawResponse: data as any,
        },
      });

      this.logger.log(`License validated: ${data.status}`);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        if (status === 401 || status === 403) {
          this.logger.warn(`License rejected: HTTP ${status}`);
          await this.prisma.licenseCache.upsert({
            where: { id: 'singleton' },
            update: {
              licenseKey: this.licenseKey,
              status: 'SUSPENDED',
              lastCheckedAt: now,
            },
            create: {
              id: 'singleton',
              licenseKey: this.licenseKey,
              status: 'SUSPENDED',
              lastCheckedAt: now,
            },
          });
          return;
        }
      }

      // Network error or 5xx — don't change status
      this.logger.warn(
        `License validation failed (network/server error), retaining cached status`,
      );
    }
  }

  async getMemberLimit(): Promise<number | null> {
    const cache = await this.prisma.licenseCache.findUnique({
      where: { id: 'singleton' },
    });
    return cache?.maxMembers ?? null;
  }

  async onModuleInit(): Promise<void> {
    if (this.isConfigured()) {
      this.logger.log('Validating license on startup...');
      await this.validateLicense();
    } else {
      this.logger.warn(
        'No LICENSE_KEY configured — running in unlicensed dev mode',
      );
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=licensing.service`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/licensing/licensing.service.ts src/licensing/licensing.service.spec.ts
git commit -m "feat(licensing): add LicensingService with phone-home and grace period"
```

---

### Task 5: LicenseGuard — Global Request Gate

**Files:**
- Create: `src/licensing/licensing.guard.spec.ts`
- Create: `src/licensing/licensing.guard.ts`

**Step 1: Write the failing tests**

Create `src/licensing/licensing.guard.spec.ts`:

```typescript
import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { LicenseGuard } from './licensing.guard';
import { LicensingService } from './licensing.service';

describe('LicenseGuard', () => {
  let guard: LicenseGuard;
  let licensingService: Partial<LicensingService>;

  beforeEach(() => {
    licensingService = {
      isActive: jest.fn(),
    };
    guard = new LicenseGuard(licensingService as LicensingService);
  });

  const createMockContext = (url: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ url }),
      }),
    }) as any;

  it('should allow request when license is active', async () => {
    (licensingService.isActive as jest.Mock).mockResolvedValue(true);
    const result = await guard.canActivate(createMockContext('/api/v1/users'));
    expect(result).toBe(true);
  });

  it('should throw ServiceUnavailableException when license is inactive', async () => {
    (licensingService.isActive as jest.Mock).mockResolvedValue(false);
    await expect(
      guard.canActivate(createMockContext('/api/v1/users')),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('should skip check for /api/health', async () => {
    (licensingService.isActive as jest.Mock).mockResolvedValue(false);
    const result = await guard.canActivate(createMockContext('/api/health'));
    expect(result).toBe(true);
    expect(licensingService.isActive).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=licensing.guard`
Expected: FAIL — `Cannot find module './licensing.guard'`

**Step 3: Write the LicenseGuard implementation**

Create `src/licensing/licensing.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { LicensingService } from './licensing.service';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly licensingService: LicensingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const url: string = request.url;

    // Always allow health check
    if (url.startsWith('/api/health')) return true;

    const active = await this.licensingService.isActive();
    if (!active) {
      throw new ServiceUnavailableException(
        "This gym's subscription is inactive. Contact your administrator.",
      );
    }

    return true;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=licensing.guard`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/licensing/licensing.guard.ts src/licensing/licensing.guard.spec.ts
git commit -m "feat(licensing): add global LicenseGuard"
```

---

### Task 6: LicenseCron — Daily Phone-Home

**Files:**
- Create: `src/licensing/licensing.cron.ts`

**Step 1: Create the cron service**

Create `src/licensing/licensing.cron.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LicensingService } from './licensing.service';

@Injectable()
export class LicenseCron {
  private readonly logger = new Logger(LicenseCron.name);

  constructor(private readonly licensingService: LicensingService) {}

  @Cron('0 3 * * *') // Daily at 3 AM
  async handleLicenseValidation(): Promise<void> {
    this.logger.log('Running daily license validation...');
    await this.licensingService.validateLicense();
  }
}
```

**Step 2: Commit**

```bash
git add src/licensing/licensing.cron.ts
git commit -m "feat(licensing): add daily license validation cron"
```

---

### Task 7: LicensingModule + App Integration

**Files:**
- Create: `src/licensing/licensing.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create the module**

Create `src/licensing/licensing.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { LicenseCron } from './licensing.cron';
import { LicenseGuard } from './licensing.guard';

@Global()
@Module({
  providers: [LicensingService, LicenseCron, LicenseGuard],
  exports: [LicensingService, LicenseGuard],
})
export class LicensingModule {}
```

**Step 2: Register in AppModule**

In `src/app.module.ts`:

Add import at the top:

```typescript
import { LicensingModule } from './licensing/licensing.module';
import { LicenseGuard } from './licensing/licensing.guard';
```

Add `LicensingModule` to the `imports` array (before other modules, after config/infra modules):

```typescript
imports: [
  ConfigLoaderModule,
  ThrottlerModule.forRoot({
    throttlers: [{ ttl: 60000, limit: 30 }],
  }),
  ScheduleModule.forRoot(),
  EventEmitterModule.forRoot(),
  SentryModule.forRoot(),
  LicensingModule,
  // ... rest of modules
```

Add `LicenseGuard` as a global guard. It must be registered **before** `ThrottlerGuard` so licensing is checked first. Update the `providers` array:

```typescript
providers: [
  {
    provide: APP_FILTER,
    useClass: SentryGlobalFilter,
  },
  {
    provide: APP_GUARD,
    useClass: LicenseGuard,
  },
  {
    provide: APP_GUARD,
    useClass: ThrottlerGuard,
  },
  AppService,
],
```

**Step 3: Commit**

```bash
git add src/licensing/licensing.module.ts src/app.module.ts
git commit -m "feat(licensing): register LicensingModule and global LicenseGuard"
```

---

### Task 8: Health Check Endpoint

**Files:**
- Modify: `src/app.controller.ts`

**Step 1: Add health endpoint**

Update `src/app.controller.ts`:

```typescript
import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @Version(VERSION_NEUTRAL)
  @ApiExcludeEndpoint()
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
```

Note: `@Version(VERSION_NEUTRAL)` makes it `/api/health` instead of `/api/v1/health`.

**Step 2: Verify health endpoint is accessible**

Run: `yarn build`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add src/app.controller.ts
git commit -m "feat: add /api/health endpoint (bypasses license guard)"
```

---

### Task 9: Member Limit Enforcement

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.module.ts`

**Step 1: Add member limit check to registration**

In `src/auth/auth.service.ts`, add import:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { LicensingService } from '../licensing/licensing.service';
```

Add `LicensingService` to the constructor:

```typescript
constructor(
  private prisma: PrismaService,
  private jwtService: JwtService,
  private emailService: EmailService,
  private configService: ConfigService,
  private readonly eventEmitter: EventEmitter2,
  private readonly licensingService: LicensingService,
) {}
```

In the `register` method, add member limit check **before** creating the user (after the duplicate email check):

```typescript
// Check member limit from license
const maxMembers = await this.licensingService.getMemberLimit();
if (maxMembers !== null) {
  const currentCount = await this.prisma.user.count({
    where: { role: 'MEMBER' },
  });
  if (currentCount >= maxMembers) {
    throw new ForbiddenException(
      'Member limit reached for your subscription tier.',
    );
  }
}
```

**Step 2: Update auth.module.ts if needed**

Since `LicensingModule` is `@Global()`, no import changes needed in `AuthModule`.

**Step 3: Run existing auth tests**

Run: `yarn test -- --testPathPattern=auth`
Expected: Tests may need updating to mock `LicensingService`. If they fail, add a mock:

```typescript
const mockLicensingService = {
  getMemberLimit: jest.fn().mockResolvedValue(null),
};
// Add to providers:
{ provide: LicensingService, useValue: mockLicensingService },
```

**Step 4: Commit**

```bash
git add src/auth/auth.service.ts
git commit -m "feat(licensing): enforce member limit on registration"
```

---

### Task 10: Update CLAUDE.md and Environment Docs

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add licensing info to CLAUDE.md**

Add to the **Modules** section:
```
- `licensing/` — SaaS license validation. Daily phone-home to control plane. Global `LicenseGuard` returns 503 when license invalid (7-day grace period). Dev mode when `LICENSE_KEY` unset.
```

Add to the **Environment Variables** section:
```
- `LICENSE_KEY` — Unique license key per gym instance (optional in dev — unlicensed mode when unset)
- `LICENSE_SERVER_URL` — Control plane base URL for license validation (optional in dev)
```

Add to the **Security** section:
```
- **License enforcement**: Global `LicenseGuard` checks cached license on every request. 7-day grace period on network failures. `GET /api/health` bypasses guard. Member registration capped by license tier.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add licensing module to CLAUDE.md"
```

---

### Task 11: Run Full Test Suite

**Step 1: Run all tests**

Run: `yarn test`
Expected: All tests pass (existing + new licensing tests).

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 3: Run build**

Run: `yarn build`
Expected: Build succeeds.
