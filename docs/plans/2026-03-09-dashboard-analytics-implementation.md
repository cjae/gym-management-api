# Dashboard Analytics + WebSocket Activity Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align analytics API fields with frontend expectations, add expiring-memberships endpoint, and replace pull-based activity feed with real-time WebSocket (Socket.IO) broadcasting to admin users.

**Architecture:** EventEmitter2 decouples domain events from WebSocket broadcasting. Services emit events after DB writes; ActivityGateway listens and broadcasts to JWT-authenticated ADMIN/SUPER_ADMIN clients via Socket.IO. Dashboard endpoint drops recentActivity (replaced by WebSocket).

**Tech Stack:** NestJS WebSockets (`@nestjs/websockets`, `@nestjs/platform-socket.io`), `@nestjs/event-emitter`, Socket.IO, `@nestjs/jwt` for WS auth

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install WebSocket and event emitter packages**

Run:
```bash
yarn add @nestjs/websockets @nestjs/platform-socket.io @nestjs/event-emitter socket.io
```

**Step 2: Verify installation**

Run: `yarn build`
Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add websocket and event-emitter dependencies"
```

---

### Task 2: Register EventEmitterModule Globally

**Files:**
- Modify: `src/app.module.ts`

**Step 1: Add EventEmitterModule import**

Add to imports array in `AppModule`:

```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';
```

Add `EventEmitterModule.forRoot()` to the `imports` array (after `ScheduleModule.forRoot()`).

**Step 2: Verify build**

Run: `yarn build`
Expected: BUILD SUCCESS

**Step 3: Commit**

```bash
git add src/app.module.ts
git commit -m "chore: register EventEmitterModule globally"
```

---

### Task 3: Rename Dashboard Response Fields

Align field names with frontend `DashboardStats` type expectations.

**Files:**
- Modify: `src/analytics/analytics.service.ts` (interface + getDashboard method)
- Modify: `src/analytics/dto/dashboard-response.dto.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Update the `DashboardResult` interface in `analytics.service.ts`**

Change `attendance` fields:
```typescript
attendance: {
  todayCheckIns: number;       // was: today
  thisWeekCheckIns: number;    // was: thisWeek
  avgDaily30Days: number;      // was: avgDailyLast30Days
};
```

Change `payments` fields:
```typescript
payments: {
  pendingCount30Days: number;  // was: pendingLast30Days
  failedCount30Days: number;   // was: failedLast30Days
};
```

**Step 2: Update the `getDashboard` method in `analytics.service.ts`**

In the dashboard object construction (~line 168-192), rename the keys:
```typescript
attendance: {
  todayCheckIns: attendanceToday,
  thisWeekCheckIns: attendanceThisWeek,
  avgDaily30Days,              // rename variable too
},
payments: {
  pendingCount30Days: pendingPayments,
  failedCount30Days: failedPayments,
},
```

Also rename the variable `avgDailyLast30Days` to `avgDaily30Days` on line ~165-166.

**Step 3: Update `dashboard-response.dto.ts`**

Rename `AttendanceStatsDto` properties:
```typescript
class AttendanceStatsDto {
  @ApiProperty({ example: 45 })
  todayCheckIns: number;

  @ApiProperty({ example: 280 })
  thisWeekCheckIns: number;

  @ApiProperty({ example: 42.5 })
  avgDaily30Days: number;
}
```

Rename `PaymentStatsDto` properties:
```typescript
class PaymentStatsDto {
  @ApiProperty({ example: 3 })
  pendingCount30Days: number;

  @ApiProperty({ example: 1 })
  failedCount30Days: number;
}
```

**Step 4: Update test file `analytics.service.spec.ts`**

The `getDashboard` tests don't assert on attendance/payment field names directly, but verify by checking the mock call order. No assertion changes needed for field renames since tests check `result.members` only.

However, if any test asserts on `result.attendance.today` or similar, update to match new names.

**Step 5: Run tests**

Run: `yarn test -- --testPathPattern=analytics`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/dto/dashboard-response.dto.ts src/analytics/analytics.service.spec.ts
git commit -m "refactor(analytics): rename dashboard fields to match frontend types"
```

---

### Task 4: Remove recentActivity from Dashboard

**Files:**
- Modify: `src/analytics/analytics.service.ts`
- Modify: `src/analytics/dto/dashboard-response.dto.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Remove from `DashboardResult` interface**

Remove `recentActivity: ActivityItem[];` from the interface. Keep the `ActivityItem` interface — it will be reused by the WebSocket gateway.

**Step 2: Remove `getRecentActivity()` call from `getDashboard()`**

- Remove `recentActivity` from the `Promise.all` destructuring (line ~86, element index 13)
- Remove the `this.getRecentActivity()` call from Promise.all array
- Remove `recentActivity` from the dashboard object construction

**Step 3: Remove `ActivityItemDto` and `recentActivity` from `DashboardResponseDto`**

In `dashboard-response.dto.ts`, remove:
```typescript
class ActivityItemDto { ... }
```

And remove from `DashboardResponseDto`:
```typescript
@ApiProperty({ type: [ActivityItemDto] })
recentActivity: ActivityItemDto[];
```

**Step 4: Update tests**

- Remove the `getRecentActivity` test suite entirely (lines ~143-207)
- In `getDashboard` `beforeEach`, remove mock setup for recentActivity:
  - Remove `mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([])` (the first call, line ~76, which was for getRecentActivity)
  - Remove `mockPrisma.user.findMany.mockResolvedValue([])` (line ~97)
  - Remove `mockPrisma.payment.findMany.mockResolvedValue([])` (line ~98)
  - Remove `mockPrisma.attendance.findMany.mockResolvedValue([])` (line ~89)
- Verify remaining mock call order is correct after removals

**Step 5: Run tests**

Run: `yarn test -- --testPathPattern=analytics`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/dto/dashboard-response.dto.ts src/analytics/analytics.service.spec.ts
git commit -m "refactor(analytics): remove recentActivity from dashboard endpoint"
```

---

### Task 5: Add Expiring Memberships Endpoint

**Files:**
- Modify: `src/analytics/analytics.service.ts`
- Modify: `src/analytics/analytics.controller.ts`
- Create: `src/analytics/dto/expiring-memberships-response.dto.ts`
- Modify: `src/analytics/analytics.service.spec.ts`

**Step 1: Write the failing test**

Add to `analytics.service.spec.ts`:

```typescript
describe('getExpiringMemberships', () => {
  it('should return memberships expiring within 14 days sorted by urgency', async () => {
    const fiveDaysFromNow = new Date(now);
    fiveDaysFromNow.setDate(now.getDate() + 5);
    const tenDaysFromNow = new Date(now);
    tenDaysFromNow.setDate(now.getDate() + 10);

    mockPrisma.memberSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        endDate: fiveDaysFromNow,
        primaryMember: { id: 'u1', firstName: 'Jane', lastName: 'Muthoni' },
        plan: { name: 'Premium Monthly' },
      },
      {
        id: 'sub-2',
        endDate: tenDaysFromNow,
        primaryMember: { id: 'u2', firstName: 'John', lastName: 'Kamau' },
        plan: { name: 'Basic Monthly' },
      },
    ]);

    const result = await service.getExpiringMemberships();

    expect(result.memberships).toHaveLength(2);
    expect(result.memberships[0]).toEqual({
      memberId: 'u1',
      memberName: 'Jane Muthoni',
      planName: 'Premium Monthly',
      expiresAt: fiveDaysFromNow,
      daysUntilExpiry: 5,
    });
    expect(result.memberships[1].daysUntilExpiry).toBe(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=analytics`
Expected: FAIL — `service.getExpiringMemberships is not a function`

**Step 3: Create response DTO**

Create `src/analytics/dto/expiring-memberships-response.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

class ExpiringMembershipDto {
  @ApiProperty({ example: 'uuid' })
  memberId: string;

  @ApiProperty({ example: 'Jane Muthoni' })
  memberName: string;

  @ApiProperty({ example: 'Premium Monthly' })
  planName: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ example: 6 })
  daysUntilExpiry: number;
}

export class ExpiringMembershipsResponseDto {
  @ApiProperty({ type: [ExpiringMembershipDto] })
  memberships: ExpiringMembershipDto[];
}
```

**Step 4: Implement `getExpiringMemberships()` in `analytics.service.ts`**

```typescript
async getExpiringMemberships() {
  const now = new Date();
  const fourteenDaysFromNow = new Date(now);
  fourteenDaysFromNow.setDate(now.getDate() + 14);

  const subscriptions = await this.prisma.memberSubscription.findMany({
    where: {
      status: 'ACTIVE',
      endDate: { gte: now, lte: fourteenDaysFromNow },
    },
    select: {
      endDate: true,
      primaryMember: {
        select: { id: true, firstName: true, lastName: true },
      },
      plan: { select: { name: true } },
    },
    orderBy: { endDate: 'asc' },
    take: 20,
  });

  const memberships = subscriptions.map((sub) => {
    const diffMs = sub.endDate.getTime() - now.getTime();
    const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return {
      memberId: sub.primaryMember.id,
      memberName: `${sub.primaryMember.firstName} ${sub.primaryMember.lastName}`,
      planName: sub.plan.name,
      expiresAt: sub.endDate,
      daysUntilExpiry,
    };
  });

  return { memberships };
}
```

**Step 5: Add controller endpoint in `analytics.controller.ts`**

```typescript
import { ExpiringMembershipsResponseDto } from './dto/expiring-memberships-response.dto';

@Get('expiring-memberships')
@Roles('ADMIN', 'SUPER_ADMIN')
@ApiOperation({
  summary: 'Get expiring memberships',
  description: 'Returns memberships expiring within 14 days, sorted by urgency.',
})
@ApiOkResponse({ type: ExpiringMembershipsResponseDto })
getExpiringMemberships() {
  return this.analyticsService.getExpiringMemberships();
}
```

**Step 6: Run tests**

Run: `yarn test -- --testPathPattern=analytics`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/analytics/
git commit -m "feat(analytics): add expiring-memberships endpoint"
```

---

### Task 6: Create ActivityGateway with JWT Auth

**Files:**
- Create: `src/analytics/activity.gateway.ts`
- Modify: `src/analytics/analytics.module.ts`
- Create: `src/analytics/activity.gateway.spec.ts`

**Step 1: Write the failing test**

Create `src/analytics/activity.gateway.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityGateway } from './activity.gateway';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('ActivityGateway', () => {
  let gateway: ActivityGateway;
  let jwtService: JwtService;

  const mockPrisma = {
    invalidatedToken: { findUnique: jest.fn() },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({ jwtSecret: 'test-secret' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityGateway,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    gateway = module.get<ActivityGateway>(ActivityGateway);
    jwtService = module.get<JwtService>(JwtService);
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should disconnect client with no token', async () => {
      const mockClient = {
        handshake: { auth: {} },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as any);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should disconnect client with non-admin role', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'u1',
        role: 'MEMBER',
        jti: 'jti-1',
      });
      mockPrisma.invalidatedToken.findUnique.mockResolvedValue(null);

      const mockClient = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as any);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should accept ADMIN connections', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'u1',
        role: 'ADMIN',
        jti: 'jti-1',
      });
      mockPrisma.invalidatedToken.findUnique.mockResolvedValue(null);

      const mockClient = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as any);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('should reject invalidated tokens', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'u1',
        role: 'ADMIN',
        jti: 'jti-1',
      });
      mockPrisma.invalidatedToken.findUnique.mockResolvedValue({ jti: 'jti-1' });

      const mockClient = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as any);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('event broadcasting', () => {
    it('should broadcast activity events to connected clients', () => {
      const mockServer = { emit: jest.fn() };
      gateway.server = mockServer as any;

      const payload = {
        type: 'registration' as const,
        description: 'John Doe registered as a new member',
        timestamp: new Date().toISOString(),
        metadata: { memberId: 'u1' },
      };

      gateway.handleRegistration(payload);

      expect(mockServer.emit).toHaveBeenCalledWith('activity', payload);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=activity.gateway`
Expected: FAIL — cannot find module `./activity.gateway`

**Step 3: Implement ActivityGateway**

Create `src/analytics/activity.gateway.ts`:

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { AuthConfig, getAuthConfigName } from '../common/config/auth.config';

export interface ActivityEvent {
  type: 'registration' | 'check_in' | 'payment' | 'subscription';
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

@WebSocketGateway({ namespace: '/activity', cors: true })
export class ActivityGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ActivityGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const authConfig = this.configService.get<AuthConfig>(getAuthConfigName())!;
      const payload = await this.jwtService.verifyAsync(token, {
        secret: authConfig.jwtSecret,
      });

      // Check token not invalidated
      const invalidated = await this.prisma.invalidatedToken.findUnique({
        where: { jti: payload.jti },
      });
      if (invalidated) {
        client.disconnect();
        return;
      }

      // Only allow ADMIN and SUPER_ADMIN
      if (!['ADMIN', 'SUPER_ADMIN'].includes(payload.role)) {
        client.disconnect();
        return;
      }

      this.logger.log(`Admin connected: ${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  @OnEvent('activity.registration')
  handleRegistration(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }

  @OnEvent('activity.check_in')
  handleCheckIn(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }

  @OnEvent('activity.payment')
  handlePayment(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }

  @OnEvent('activity.subscription')
  handleSubscription(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }
}
```

**Step 4: Register gateway and dependencies in `analytics.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ActivityGateway } from './activity.gateway';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ActivityGateway],
})
export class AnalyticsModule {}
```

**Step 5: Run tests**

Run: `yarn test -- --testPathPattern=activity.gateway`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/analytics/
git commit -m "feat(analytics): add WebSocket ActivityGateway with JWT auth"
```

---

### Task 7: Emit Events from AuthService (Registration)

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.service.spec.ts` (if exists)

**Step 1: Inject EventEmitter2 into AuthService**

Add to constructor:
```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

constructor(
  // ...existing deps
  private readonly eventEmitter: EventEmitter2,
) {}
```

**Step 2: Emit event after user creation in `register()` method**

After the user is created (after `this.prisma.user.create()`), add:

```typescript
this.eventEmitter.emit('activity.registration', {
  type: 'registration',
  description: `${user.firstName} ${user.lastName} registered as a new member`,
  timestamp: new Date().toISOString(),
  metadata: { memberId: user.id },
});
```

**Step 3: Update test — add EventEmitter2 mock**

In `auth.service.spec.ts`, add mock:
```typescript
const mockEventEmitter = { emit: jest.fn() };
```

Add to providers:
```typescript
{ provide: EventEmitter2, useValue: mockEventEmitter },
```

Import:
```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
```

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern=auth`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/auth/
git commit -m "feat(auth): emit activity event on member registration"
```

---

### Task 8: Emit Events from AttendanceService (Check-in)

**Files:**
- Modify: `src/attendance/attendance.service.ts`
- Modify: `src/attendance/attendance.service.spec.ts` (if exists)

**Step 1: Inject EventEmitter2 into AttendanceService**

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

constructor(
  // ...existing deps
  private readonly eventEmitter: EventEmitter2,
) {}
```

**Step 2: Emit event after check-in creation in `checkIn()` method**

After the attendance record is created, add:

```typescript
this.eventEmitter.emit('activity.check_in', {
  type: 'check_in',
  description: `${member.firstName} ${member.lastName} checked in`,
  timestamp: new Date().toISOString(),
  metadata: { memberId },
});
```

Note: you may need to fetch member name if it isn't already available in scope. Check the method — if `member` info isn't loaded, query it or use the existing data.

**Step 3: Update test — add EventEmitter2 mock**

Same pattern as Task 7.

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern=attendance`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/attendance/
git commit -m "feat(attendance): emit activity event on check-in"
```

---

### Task 9: Emit Events from PaymentsService (Payment Status Change)

**Files:**
- Modify: `src/payments/payments.service.ts`
- Modify: `src/payments/payments.service.spec.ts` (if exists)

**Step 1: Inject EventEmitter2 into PaymentsService**

Same pattern as Tasks 7-8.

**Step 2: Emit event after payment status changes in webhook handler**

After payment status update to PAID (~line 147):
```typescript
this.eventEmitter.emit('activity.payment', {
  type: 'payment',
  description: `${memberName} made a payment of ${amount} ${currency}`,
  timestamp: new Date().toISOString(),
  metadata: { paymentId, amount, status: 'PAID' },
});
```

After payment status update to FAILED (~line 199):
```typescript
this.eventEmitter.emit('activity.payment', {
  type: 'payment',
  description: `Payment of ${amount} ${currency} by ${memberName} failed`,
  timestamp: new Date().toISOString(),
  metadata: { paymentId, amount, status: 'FAILED' },
});
```

Note: Extract member name and payment details from the existing data available in the webhook handler scope.

**Step 3: Update test — add EventEmitter2 mock**

Same pattern.

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern=payments`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/payments/
git commit -m "feat(payments): emit activity events on payment status changes"
```

---

### Task 10: Emit Events from SubscriptionsService (Create/Cancel)

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts`
- Modify: `src/subscriptions/subscriptions.service.spec.ts` (if exists)

**Step 1: Inject EventEmitter2 into SubscriptionsService**

Same pattern.

**Step 2: Emit event after subscription creation in `create()` method**

After subscription is created:
```typescript
this.eventEmitter.emit('activity.subscription', {
  type: 'subscription',
  description: `${memberName} started a ${planName} subscription`,
  timestamp: new Date().toISOString(),
  metadata: { subscriptionId: subscription.id, planName, status: 'ACTIVE' },
});
```

**Step 3: Emit event after subscription cancellation in `cancel()` method**

After subscription is cancelled:
```typescript
this.eventEmitter.emit('activity.subscription', {
  type: 'subscription',
  description: `${memberName} cancelled their ${planName} subscription`,
  timestamp: new Date().toISOString(),
  metadata: { subscriptionId, planName, status: 'CANCELLED' },
});
```

Note: Fetch member and plan names from existing data in scope. Check method implementation for available variables.

**Step 4: Update test — add EventEmitter2 mock**

Same pattern.

**Step 5: Run tests**

Run: `yarn test -- --testPathPattern=subscriptions`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/subscriptions/
git commit -m "feat(subscriptions): emit activity events on create and cancel"
```

---

### Task 11: Full Test Suite + Build Verification

**Step 1: Run all tests**

Run: `yarn test`
Expected: ALL PASS

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 3: Run build**

Run: `yarn build`
Expected: BUILD SUCCESS

**Step 4: Commit any remaining fixes if needed**

---

### Task 12: Clean Up getRecentActivity Method

After confirming everything works, the `getRecentActivity()` method in `analytics.service.ts` is no longer called by any code. Remove it.

**Files:**
- Modify: `src/analytics/analytics.service.ts`

**Step 1: Remove `getRecentActivity()` method**

Delete the entire method (lines ~257-376) and the `ActivityItem` interface if it's no longer imported anywhere (the ActivityGateway defines its own `ActivityEvent` interface).

**Step 2: Run tests**

Run: `yarn test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/analytics/analytics.service.ts
git commit -m "refactor(analytics): remove unused getRecentActivity method"
```
