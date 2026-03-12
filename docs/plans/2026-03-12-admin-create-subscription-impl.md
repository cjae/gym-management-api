# Admin Create Subscription Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add admin subscription creation for offline payments, fix member subscriptions to start as PENDING until payment, add hourly cleanup cron, and enforce one pending payment per subscription.

**Architecture:** Separate admin endpoint (`POST /subscriptions/admin`) from member self-service. New `PENDING` status for member-created subscriptions, activated by Paystack webhook. New `CASH`/`COMPLIMENTARY` payment methods for offline admin flows. Hourly cron cleans up abandoned pending subscriptions.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest

---

### Task 1: Schema Changes — Enums and Model Fields

**Files:**
- Modify: `prisma/schema.prisma:23-28` (SubscriptionStatus enum)
- Modify: `prisma/schema.prisma:46-49` (PaymentMethod enum)
- Modify: `prisma/schema.prisma:120-141` (MemberSubscription model)
- Modify: `prisma/schema.prisma:275-288` (Payment model)

**Step 1: Update SubscriptionStatus enum**

```prisma
enum SubscriptionStatus {
  PENDING
  ACTIVE
  FROZEN
  EXPIRED
  CANCELLED
}
```

**Step 2: Update PaymentMethod enum**

```prisma
enum PaymentMethod {
  CARD
  MPESA
  CASH
  COMPLIMENTARY
}
```

**Step 3: Add fields to MemberSubscription**

Add these fields after `frozenDaysUsed` (line 133), before `createdAt`:

```prisma
  paymentNote               String?
  createdBy                 String?
```

Add this relation after the `payments` relation (line 140):

```prisma
  createdByUser User? @relation("SubscriptionCreator", fields: [createdBy], references: [id])
```

**Step 4: Add paymentNote to Payment model**

Add after `failureReason` (line 283):

```prisma
  paymentNote       String?
```

**Step 5: Add reverse relation on User model**

Find the User model and add:

```prisma
  createdSubscriptions MemberSubscription[] @relation("SubscriptionCreator")
```

**Step 6: Run migration**

Run: `npx prisma migrate dev --name add-pending-status-and-admin-subscription-fields`
Expected: Migration created and applied, Prisma client regenerated.

**Step 7: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add PENDING status, CASH/COMPLIMENTARY methods, admin subscription fields"
```

---

### Task 2: Update Member Subscription Creation to PENDING

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts:20-75` (create method)
- Test: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Write the failing test**

Add to `subscriptions.service.spec.ts` inside a new `describe('create', ...)` block:

```typescript
describe('create', () => {
  const mockPlan = {
    id: 'plan-1',
    name: 'Monthly',
    billingInterval: 'MONTHLY',
    price: 5000,
    maxMembers: 1,
    maxFreezeDays: 0,
    isActive: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create subscription with PENDING status', async () => {
    mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      firstName: 'Jane',
      lastName: 'Doe',
    });
    mockPrisma.memberSubscription.create.mockResolvedValueOnce({
      id: 'sub-1',
      primaryMemberId: 'user-1',
      planId: 'plan-1',
      status: 'PENDING',
      paymentMethod: 'MPESA',
    });

    const result = await service.create('user-1', {
      planId: 'plan-1',
      paymentMethod: 'MPESA' as any,
    });

    expect(result.status).toBe('PENDING');
    expect(mockPrisma.memberSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
        }),
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: FAIL — `create` currently doesn't pass `status: 'PENDING'` (it uses the default ACTIVE).

**Step 3: Update the create method**

In `subscriptions.service.ts`, modify the `create` method. Change the `prisma.memberSubscription.create` call (line 38) to include `status: SubscriptionStatus.PENDING`:

```typescript
const subscription = await this.prisma.memberSubscription.create({
  data: {
    primaryMemberId: memberId,
    planId: dto.planId,
    startDate,
    endDate,
    status: SubscriptionStatus.PENDING,
    paymentMethod: dto.paymentMethod,
    nextBillingDate: endDate,
    members: {
      create: {
        memberId,
      },
    },
  },
  include: {
    plan: true,
    members: true,
  },
});
```

Also update the event emission to use `SubscriptionStatus.PENDING` instead of `SubscriptionStatus.ACTIVE`:

```typescript
this.eventEmitter.emit('activity.subscription', {
  type: 'subscription',
  description: `${memberName} started a ${planName} subscription (pending payment)`,
  timestamp: new Date().toISOString(),
  metadata: {
    subscriptionId: subscription.id,
    planName,
    status: SubscriptionStatus.PENDING,
  },
});
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/subscriptions/subscriptions.service.ts src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat(subscriptions): create member subscriptions as PENDING"
```

---

### Task 3: Filter PENDING from Subscription Queries

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts:134-201` (findByMember, findAll)
- Test: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Write the failing tests**

Add to `subscriptions.service.spec.ts`:

```typescript
describe('findByMember', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should exclude PENDING subscriptions', async () => {
    mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([]);

    await service.findByMember('user-1');

    expect(mockPrisma.memberSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: 'PENDING' },
        }),
      }),
    );
  });
});

describe('findAll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should exclude PENDING subscriptions', async () => {
    mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([]);
    mockPrisma.memberSubscription.count.mockResolvedValueOnce(0);

    await service.findAll(1, 20);

    const findManyCall = mockPrisma.memberSubscription.findMany.mock.calls[0][0];
    expect(findManyCall.where).toEqual({ status: { not: 'PENDING' } });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: FAIL — no `where` filter on status currently.

**Step 3: Add PENDING filter to findByMember**

In `subscriptions.service.ts`, update `findByMember` (line 135) to add a status filter:

```typescript
async findByMember(memberId: string) {
  const subscriptions = await this.prisma.memberSubscription.findMany({
    where: {
      members: {
        some: { memberId },
      },
      status: { not: 'PENDING' as SubscriptionStatus },
    },
    include: {
      plan: true,
      members: {
        include: {
          member: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return subscriptions.map(({ paystackAuthorizationCode, ...sub }) => sub);
}
```

**Step 4: Add PENDING filter to findAll**

In `subscriptions.service.ts`, update `findAll` (line 161). Add a `where` clause to both `findMany` and `count`:

```typescript
async findAll(page: number = 1, limit: number = 20) {
  const where = { status: { not: 'PENDING' as SubscriptionStatus } };
  const include = {
    primaryMember: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
    plan: true,
    members: {
      include: {
        member: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    },
  };

  const [subscriptions, total] = await Promise.all([
    this.prisma.memberSubscription.findMany({
      where,
      include,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.memberSubscription.count({ where }),
  ]);

  const data = subscriptions.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ paystackAuthorizationCode, ...sub }) => sub,
  );
  return { data, total, page, limit };
}
```

**Step 5: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: PASS

**Step 6: Commit**

```bash
git add src/subscriptions/subscriptions.service.ts src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat(subscriptions): exclude PENDING from findByMember and findAll"
```

---

### Task 4: Payment Deduplication — One PENDING Payment Per Subscription

**Files:**
- Modify: `src/payments/payments.service.ts:70-112` (initializePayment method)
- Test: `src/payments/payments.service.spec.ts` (create if it doesn't exist)

**Step 1: Write the failing test**

In `src/payments/payments.service.spec.ts`, add a test for the deduplication behavior. If the spec file doesn't exist, create it with the standard NestJS test setup for PaymentsService (mock PrismaService, ConfigService, EventEmitter2). The test:

```typescript
it('should expire existing PENDING payment before creating new one', async () => {
  const existingPayment = {
    id: 'pay-old',
    subscriptionId: 'sub-1',
    status: 'PENDING',
    createdAt: new Date(),
  };

  mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
    id: 'sub-1',
    primaryMemberId: 'user-1',
    paymentMethod: 'CARD',
    plan: { price: 5000 },
  });
  mockPrisma.payment.findFirst.mockResolvedValueOnce(existingPayment);
  mockPrisma.payment.update.mockResolvedValueOnce({
    ...existingPayment,
    status: 'EXPIRED',
  });
  mockPrisma.payment.create.mockResolvedValueOnce({
    id: 'pay-new',
    subscriptionId: 'sub-1',
    amount: 5000,
    paymentMethod: 'CARD',
    status: 'PENDING',
  });

  // Mock axios for Paystack call
  jest.spyOn(axios, 'post').mockResolvedValueOnce({
    data: {
      data: {
        authorization_url: 'https://paystack.com/pay/test',
        access_code: 'test_code',
        reference: 'ref_123',
      },
    },
  });

  await service.initializePayment('sub-1', 'test@example.com', 'user-1');

  expect(mockPrisma.payment.update).toHaveBeenCalledWith({
    where: { id: 'pay-old' },
    data: { status: 'EXPIRED' },
  });
  expect(mockPrisma.payment.create).toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=payments.service`
Expected: FAIL — `initializePayment` doesn't check for existing pending payments.

**Step 3: Update initializePayment**

In `payments.service.ts`, add pending payment expiration at the start of `initializePayment` (after the subscription lookup and IDOR check, before creating the new payment — around line 87):

```typescript
// Expire any existing PENDING payment for this subscription
const existingPending = await this.prisma.payment.findFirst({
  where: {
    subscriptionId,
    status: 'PENDING',
  },
});
if (existingPending) {
  await this.prisma.payment.update({
    where: { id: existingPending.id },
    data: { status: 'EXPIRED' },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- --testPathPattern=payments.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/payments/payments.service.ts src/payments/payments.service.spec.ts
git commit -m "feat(payments): expire existing PENDING payment before creating new one"
```

---

### Task 5: Admin Create Subscription DTO

**Files:**
- Create: `src/subscriptions/dto/admin-create-subscription.dto.ts`

**Step 1: Create the DTO**

```typescript
import { IsString, IsEnum, IsOptional, MaxLength, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AdminPaymentMethod {
  CASH = 'CASH',
  COMPLIMENTARY = 'COMPLIMENTARY',
}

export class AdminCreateSubscriptionDto {
  @ApiProperty({ format: 'uuid', description: 'Target member ID' })
  @IsUUID()
  memberId: string;

  @ApiProperty({ format: 'uuid', description: 'Subscription plan ID' })
  @IsUUID()
  planId: string;

  @ApiProperty({
    enum: AdminPaymentMethod,
    example: 'CASH',
    description: 'Only offline payment methods allowed',
  })
  @IsEnum(AdminPaymentMethod)
  paymentMethod: AdminPaymentMethod;

  @ApiPropertyOptional({
    example: 'Cash receipt #123',
    maxLength: 500,
    description: 'Optional note about payment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentNote?: string;
}
```

**Step 2: Commit**

```bash
git add src/subscriptions/dto/admin-create-subscription.dto.ts
git commit -m "feat(subscriptions): add AdminCreateSubscriptionDto"
```

---

### Task 6: Admin Create Subscription Service Method

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts` (add `adminCreate` method)
- Test: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Write the failing tests**

Add to `subscriptions.service.spec.ts`:

```typescript
describe('adminCreate', () => {
  const mockPlan = {
    id: 'plan-1',
    name: 'Monthly',
    billingInterval: 'MONTHLY',
    price: 5000,
    maxMembers: 1,
    maxFreezeDays: 0,
    isActive: true,
  };

  const mockMember = {
    id: 'member-1',
    email: 'member@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    role: 'MEMBER',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create ACTIVE subscription with PAID payment record', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
    mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan);
    mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);
    mockPrisma.$transaction.mockImplementationOnce((fn) => fn(mockPrisma));
    mockPrisma.memberSubscription.create.mockResolvedValueOnce({
      id: 'sub-1',
      primaryMemberId: 'member-1',
      planId: 'plan-1',
      status: 'ACTIVE',
      paymentMethod: 'CASH',
      autoRenew: false,
      createdBy: 'admin-1',
    });
    mockPrisma.payment.create.mockResolvedValueOnce({
      id: 'pay-1',
      subscriptionId: 'sub-1',
      amount: 5000,
      status: 'PAID',
      paymentMethod: 'CASH',
    });

    const result = await service.adminCreate('admin-1', {
      memberId: 'member-1',
      planId: 'plan-1',
      paymentMethod: 'CASH' as any,
      paymentNote: 'Cash receipt #123',
    });

    expect(result.status).toBe('ACTIVE');
    expect(result.createdBy).toBe('admin-1');
  });

  it('should reject if target user is not a MEMBER', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      ...mockMember,
      role: 'TRAINER',
    });

    await expect(
      service.adminCreate('admin-1', {
        memberId: 'member-1',
        planId: 'plan-1',
        paymentMethod: 'CASH' as any,
      }),
    ).rejects.toThrow('Can only create subscriptions for users with MEMBER role');
  });

  it('should reject if member already has an active subscription', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
    mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan);
    mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce({
      id: 'sm-1',
    });

    await expect(
      service.adminCreate('admin-1', {
        memberId: 'member-1',
        planId: 'plan-1',
        paymentMethod: 'CASH' as any,
      }),
    ).rejects.toThrow('Member already has an active subscription');
  });

  it('should reject if plan is not active', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
    mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
      ...mockPlan,
      isActive: false,
    });

    await expect(
      service.adminCreate('admin-1', {
        memberId: 'member-1',
        planId: 'plan-1',
        paymentMethod: 'CASH' as any,
      }),
    ).rejects.toThrow('Subscription plan is not active');
  });

  it('should set amount to 0 for COMPLIMENTARY payment', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockMember);
    mockPrisma.subscriptionPlan.findUnique.mockResolvedValueOnce(mockPlan);
    mockPrisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);
    mockPrisma.$transaction.mockImplementationOnce((fn) => fn(mockPrisma));
    mockPrisma.memberSubscription.create.mockResolvedValueOnce({
      id: 'sub-1',
      status: 'ACTIVE',
      paymentMethod: 'COMPLIMENTARY',
      createdBy: 'admin-1',
    });
    mockPrisma.payment.create.mockResolvedValueOnce({
      id: 'pay-1',
      amount: 0,
      status: 'PAID',
      paymentMethod: 'COMPLIMENTARY',
    });

    await service.adminCreate('admin-1', {
      memberId: 'member-1',
      planId: 'plan-1',
      paymentMethod: 'COMPLIMENTARY' as any,
    });

    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 0,
        }),
      }),
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: FAIL — `adminCreate` method doesn't exist.

**Step 3: Implement adminCreate method**

Add `$transaction` to the mockPrisma object in the spec's `beforeEach` setup. Then add to `subscriptions.service.ts`:

Import `AdminCreateSubscriptionDto` at the top and `Role` from `@prisma/client`. Add the method after the `create` method:

```typescript
async adminCreate(adminId: string, dto: AdminCreateSubscriptionDto) {
  // Validate target user exists and is a MEMBER
  const member = await this.prisma.user.findUnique({
    where: { id: dto.memberId },
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  if (!member) {
    throw new NotFoundException(`User with id ${dto.memberId} not found`);
  }
  if (member.role !== Role.MEMBER) {
    throw new BadRequestException(
      'Can only create subscriptions for users with MEMBER role',
    );
  }

  // Validate plan exists and is active
  const plan = await this.prisma.subscriptionPlan.findUnique({
    where: { id: dto.planId },
  });
  if (!plan) {
    throw new NotFoundException(
      `Subscription plan with id ${dto.planId} not found`,
    );
  }
  if (!plan.isActive) {
    throw new BadRequestException('Subscription plan is not active');
  }

  // Check member doesn't already have an active subscription
  const hasActive = await this.hasActiveSubscription(dto.memberId);
  if (hasActive) {
    throw new BadRequestException(
      'Member already has an active subscription',
    );
  }

  const startDate = new Date();
  const endDate = getNextBillingDate(startDate, plan.billingInterval);
  const amount =
    dto.paymentMethod === 'COMPLIMENTARY' ? 0 : plan.price;

  const subscription = await this.prisma.$transaction(async (tx) => {
    const sub = await tx.memberSubscription.create({
      data: {
        primaryMemberId: dto.memberId,
        planId: dto.planId,
        startDate,
        endDate,
        status: SubscriptionStatus.ACTIVE,
        paymentMethod: dto.paymentMethod,
        nextBillingDate: endDate,
        autoRenew: false,
        createdBy: adminId,
        paymentNote: dto.paymentNote,
        members: {
          create: {
            memberId: dto.memberId,
          },
        },
      },
      include: {
        plan: true,
        members: true,
      },
    });

    await tx.payment.create({
      data: {
        subscriptionId: sub.id,
        amount,
        paymentMethod: dto.paymentMethod,
        status: 'PAID',
        paymentNote: dto.paymentNote,
      },
    });

    return sub;
  });

  const memberName = `${member.firstName} ${member.lastName}`;
  this.eventEmitter.emit('activity.subscription', {
    type: 'subscription',
    description: `Admin created a ${plan.name} subscription for ${memberName}`,
    timestamp: new Date().toISOString(),
    metadata: {
      subscriptionId: subscription.id,
      planName: plan.name,
      status: SubscriptionStatus.ACTIVE,
      createdBy: adminId,
    },
  });

  return subscription;
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/subscriptions/subscriptions.service.ts src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat(subscriptions): add adminCreate method with validations and transaction"
```

---

### Task 7: Admin Create Subscription Controller Endpoint

**Files:**
- Modify: `src/subscriptions/subscriptions.controller.ts` (add new route)

**Step 1: Add the admin endpoint**

Add after the existing `create` handler (line 49) and before the `addDuoMember` handler:

```typescript
@Post('admin')
@Roles('ADMIN', 'SUPER_ADMIN')
@ApiCreatedResponse({ type: SubscriptionResponseDto })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
@ApiBadRequestResponse({
  description: 'Invalid member, plan, or member already has active subscription',
})
@ApiNotFoundResponse({ description: 'Member or plan not found' })
adminCreate(
  @CurrentUser('id') adminId: string,
  @Body() dto: AdminCreateSubscriptionDto,
) {
  return this.subscriptionsService.adminCreate(adminId, dto);
}
```

Add the import at the top of the file:

```typescript
import { AdminCreateSubscriptionDto } from './dto/admin-create-subscription.dto';
```

**Step 2: Verify build compiles**

Run: `yarn build`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add src/subscriptions/subscriptions.controller.ts
git commit -m "feat(subscriptions): add POST /subscriptions/admin endpoint"
```

---

### Task 8: Update Response DTOs

**Files:**
- Modify: `src/subscriptions/dto/subscription-response.dto.ts` (add new fields)
- Modify: `src/payments/dto/payment-response.dto.ts` (add paymentNote, update enums)

**Step 1: Update SubscriptionResponseDto**

Add after `frozenDaysUsed` (line 41):

```typescript
@ApiPropertyOptional({ example: 'Cash receipt #123' })
paymentNote?: string;

@ApiPropertyOptional({ format: 'uuid', description: 'Admin who created this subscription' })
createdBy?: string;
```

Update the `status` enum decorator (line 22) to include PENDING:

```typescript
@ApiProperty({ enum: ['PENDING', 'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED'] })
status: SubscriptionStatus;
```

Update the `paymentMethod` enum decorator (line 25) to include new methods:

```typescript
@ApiProperty({ enum: ['CARD', 'MPESA', 'CASH', 'COMPLIMENTARY'] })
paymentMethod: PaymentMethod;
```

**Step 2: Update PaymentResponseDto**

In `src/payments/dto/payment-response.dto.ts`, update the `paymentMethod` enum (line 19):

```typescript
@ApiProperty({ enum: ['CARD', 'MPESA', 'CASH', 'COMPLIMENTARY'] })
paymentMethod: string;
```

Update the `status` enum (line 16) to include EXPIRED:

```typescript
@ApiProperty({ enum: ['PENDING', 'PAID', 'FAILED', 'EXPIRED'] })
status: string;
```

Add after `failureReason` (line 25):

```typescript
@ApiPropertyOptional({ example: 'Cash receipt #123' })
paymentNote?: string;
```

**Step 3: Commit**

```bash
git add src/subscriptions/dto/subscription-response.dto.ts src/payments/dto/payment-response.dto.ts
git commit -m "feat(dto): update response DTOs with new fields and enum values"
```

---

### Task 9: Hourly Pending Subscription Cleanup Cron

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts` (add cleanup method)
- Test: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Write the failing test**

Add to `subscriptions.service.spec.ts`:

```typescript
describe('cleanupPendingSubscriptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should delete PENDING subscriptions older than 1 hour and their payments', async () => {
    const staleSubscriptions = [
      { id: 'sub-1' },
      { id: 'sub-2' },
    ];

    mockPrisma.memberSubscription.findMany.mockResolvedValueOnce(
      staleSubscriptions,
    );
    mockPrisma.payment.deleteMany.mockResolvedValueOnce({ count: 2 });
    mockPrisma.subscriptionMember.deleteMany.mockResolvedValueOnce({ count: 2 });
    mockPrisma.memberSubscription.deleteMany.mockResolvedValueOnce({ count: 2 });

    await service.cleanupPendingSubscriptions();

    expect(mockPrisma.memberSubscription.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        createdAt: { lt: expect.any(Date) },
      },
      select: { id: true },
    });

    expect(mockPrisma.payment.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: { in: ['sub-1', 'sub-2'] } },
    });
    expect(mockPrisma.subscriptionMember.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: { in: ['sub-1', 'sub-2'] } },
    });
    expect(mockPrisma.memberSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-1', 'sub-2'] } },
    });
  });

  it('should do nothing when no stale pending subscriptions exist', async () => {
    mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([]);

    await service.cleanupPendingSubscriptions();

    expect(mockPrisma.payment.deleteMany).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: FAIL — `cleanupPendingSubscriptions` doesn't exist.

**Step 3: Implement the cleanup method**

Add imports at top of `subscriptions.service.ts`:

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';
```

Add a logger to the class (after `constructor`):

```typescript
private readonly logger = new Logger(SubscriptionsService.name);
```

Add the method at the end of the class:

```typescript
@Cron(CronExpression.EVERY_HOUR)
async cleanupPendingSubscriptions() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const staleSubscriptions = await this.prisma.memberSubscription.findMany({
    where: {
      status: 'PENDING' as SubscriptionStatus,
      createdAt: { lt: oneHourAgo },
    },
    select: { id: true },
  });

  if (staleSubscriptions.length === 0) return;

  const ids = staleSubscriptions.map((s) => s.id);

  // Delete in order: payments → subscription members → subscriptions
  await this.prisma.payment.deleteMany({
    where: { subscriptionId: { in: ids } },
  });
  await this.prisma.subscriptionMember.deleteMany({
    where: { subscriptionId: { in: ids } },
  });
  await this.prisma.memberSubscription.deleteMany({
    where: { id: { in: ids } },
  });

  this.logger.log(
    `Cleaned up ${staleSubscriptions.length} stale pending subscription(s)`,
  );
}
```

**Step 4: Add mock methods to test setup**

In the spec file, add to `mockPrisma`:

```typescript
payment: {
  deleteMany: jest.fn(),
},
subscriptionMember: {
  // add deleteMany alongside existing create/findFirst
  deleteMany: jest.fn(),
},
memberSubscription: {
  // add deleteMany alongside existing methods
  deleteMany: jest.fn(),
},
```

**Step 5: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=subscriptions.service`
Expected: PASS

**Step 6: Add ScheduleModule import**

In `src/subscriptions/subscriptions.module.ts`, add `ScheduleModule` import if not already present (it's likely already globally imported via `app.module.ts` — verify first).

**Step 7: Commit**

```bash
git add src/subscriptions/subscriptions.service.ts src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat(subscriptions): add hourly pending subscription cleanup cron"
```

---

### Task 10: Update Webhook to Activate PENDING Subscriptions

**Files:**
- Modify: `src/payments/payments.service.ts:171-202` (charge.success handler)

The webhook already sets `status: 'ACTIVE'` on the subscription (line 184), so this should work for PENDING→ACTIVE transitions without code changes. However, verify this is explicit and not relying on the default.

**Step 1: Verify the webhook handler**

Check `payments.service.ts` line 183-184. The `updateData` already includes:

```typescript
const updateData: Prisma.MemberSubscriptionUpdateInput = {
  status: 'ACTIVE',
  endDate: nextBillingDate,
  nextBillingDate,
  frozenDaysUsed: 0,
};
```

This correctly transitions PENDING→ACTIVE. No code change needed.

**Step 2: Write a verification test**

If a payments spec file exists, add a test confirming webhook activates PENDING subscriptions. If not, this is covered by the existing webhook logic. Skip if no spec file exists.

**Step 3: Commit (only if changes were made)**

No commit needed if no changes were made.

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (update Architecture section for subscriptions)

**Step 1: Update the subscriptions module description**

Update the `subscriptions/` entry under **Modules** to mention PENDING status, admin creation, and the cleanup cron. Update `payments/` entry to mention payment deduplication.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with admin subscription and PENDING status changes"
```

---

### Task 12: Run Full Test Suite and Verify

**Step 1: Run all tests**

Run: `yarn test`
Expected: All tests pass.

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 3: Run build**

Run: `yarn build`
Expected: Build succeeds.

**Step 4: Final commit (if any lint fixes)**

```bash
git add -A
git commit -m "chore: lint fixes"
```
