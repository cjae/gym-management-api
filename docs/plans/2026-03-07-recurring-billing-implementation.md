# Recurring Subscription Billing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add recurring billing with auto-charge for card users (via Paystack authorization codes) and reminder-driven renewal for M-Pesa users, powered by a daily cron job.

**Architecture:** The system owns the billing cycle. A daily cron job queries due subscriptions and either auto-charges card users or sends payment reminders to M-Pesa users. A new `Payment` table tracks every charge attempt independently from subscription state. First payment saves the card authorization code for future charges.

**Tech Stack:** NestJS 11, `@nestjs/schedule` (cron), Prisma 6, Paystack API (charge authorization), Handlebars email templates.

**Design doc:** `docs/plans/2026-03-07-recurring-billing-design.md`

---

### Task 1: Install @nestjs/schedule and register ScheduleModule

**Files:**
- Modify: `package.json`
- Modify: `src/app.module.ts:23-39`

**Step 1: Install the package**

Run:
```bash
yarn add @nestjs/schedule
```

**Step 2: Import ScheduleModule in AppModule**

In `src/app.module.ts`, add:
```typescript
import { ScheduleModule } from '@nestjs/schedule';
```

Add `ScheduleModule.forRoot()` to the `imports` array (after `ConfigLoaderModule`).

**Step 3: Verify the app still starts**

Run:
```bash
yarn build
```
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add package.json yarn.lock src/app.module.ts
git commit -m "chore: add @nestjs/schedule for cron job support"
```

---

### Task 2: Update Prisma schema with new enums, fields, and Payment table

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add new enums**

After the existing `PaymentStatus` enum (line 29-33), add:

```prisma
enum BillingInterval {
  DAILY
  WEEKLY
  MONTHLY
  QUARTERLY
  BI_ANNUALLY
  ANNUALLY
}

enum PaymentMethod {
  CARD
  MPESA
}
```

**Step 2: Update SubscriptionPlan model**

Replace `durationDays Int` with:
```prisma
billingInterval BillingInterval @default(MONTHLY)
```

**Step 3: Update MemberSubscription model**

Remove:
- `paystackReference String?`
- `paymentStatus PaymentStatus @default(PENDING)`

Add:
```prisma
paymentMethod             PaymentMethod @default(MPESA)
paystackAuthorizationCode String?
autoRenew                 Boolean       @default(true)
nextBillingDate           DateTime?
payments                  Payment[]
```

Keep `startDate`, `endDate`, `status` as-is. `endDate` now represents the end of the current billing period (same as `nextBillingDate` conceptually, but `nextBillingDate` is what the cron checks).

**Step 4: Add Payment model**

```prisma
model Payment {
  id                String        @id @default(uuid())
  subscriptionId    String
  amount            Float
  currency          String        @default("KES")
  status            PaymentStatus @default(PENDING)
  paymentMethod     PaymentMethod
  paystackReference String?
  failureReason     String?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  subscription MemberSubscription @relation(fields: [subscriptionId], references: [id])
}
```

**Step 5: Create and apply migration**

Run:
```bash
npx prisma migrate dev --name add-recurring-billing
```

Note: This migration is destructive (removes `durationDays`, `paystackReference`, `paymentStatus`). If there's existing data, you may need a multi-step migration. For this MVP with seed data, a clean migration is fine — re-seed after.

**Step 6: Regenerate Prisma client**

Run:
```bash
npx prisma generate
```

**Step 7: Commit**

```bash
git add prisma/
git commit -m "feat: add recurring billing schema - BillingInterval, PaymentMethod, Payment table"
```

---

### Task 3: Update SubscriptionPlan DTOs and service

**Files:**
- Modify: `src/subscription-plans/dto/create-plan.dto.ts`
- Modify: `src/subscription-plans/dto/update-plan.dto.ts`
- Modify: `src/subscription-plans/subscription-plans.service.ts`

**Step 1: Update CreatePlanDto**

Replace `durationDays` field with `billingInterval`:

```typescript
import { IsString, IsNumber, IsOptional, IsInt, Min, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';

export class CreatePlanDto {
  @ApiProperty({ example: 'Monthly Plan' })
  @IsString()
  name: string;

  @ApiProperty({ example: 2500 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ enum: BillingInterval, example: 'MONTHLY' })
  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @ApiPropertyOptional({ example: 'Full access monthly subscription' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxMembers?: number;
}
```

**Step 2: Update UpdatePlanDto**

Replace `durationDays` with:

```typescript
@ApiPropertyOptional({ enum: BillingInterval, example: 'MONTHLY' })
@IsOptional()
@IsEnum(BillingInterval)
billingInterval?: BillingInterval;
```

Add the `IsEnum` import and `BillingInterval` import from `@prisma/client`.

**Step 3: Verify build**

Run:
```bash
yarn build
```
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/subscription-plans/
git commit -m "feat: update subscription plan DTOs for billingInterval"
```

---

### Task 4: Add billing interval utility

**Files:**
- Create: `src/common/utils/billing.util.ts`

**Step 1: Write the failing test**

Create `src/common/utils/billing.util.spec.ts`:

```typescript
import { getNextBillingDate } from './billing.util';
import { BillingInterval } from '@prisma/client';

describe('getNextBillingDate', () => {
  const base = new Date('2026-03-07T00:00:00Z');

  it('should add 1 day for DAILY', () => {
    const result = getNextBillingDate(base, BillingInterval.DAILY);
    expect(result).toEqual(new Date('2026-03-08T00:00:00Z'));
  });

  it('should add 7 days for WEEKLY', () => {
    const result = getNextBillingDate(base, BillingInterval.WEEKLY);
    expect(result).toEqual(new Date('2026-03-14T00:00:00Z'));
  });

  it('should add 1 month for MONTHLY', () => {
    const result = getNextBillingDate(base, BillingInterval.MONTHLY);
    expect(result).toEqual(new Date('2026-04-07T00:00:00Z'));
  });

  it('should add 3 months for QUARTERLY', () => {
    const result = getNextBillingDate(base, BillingInterval.QUARTERLY);
    expect(result).toEqual(new Date('2026-06-07T00:00:00Z'));
  });

  it('should add 6 months for BI_ANNUALLY', () => {
    const result = getNextBillingDate(base, BillingInterval.BI_ANNUALLY);
    expect(result).toEqual(new Date('2026-09-07T00:00:00Z'));
  });

  it('should add 1 year for ANNUALLY', () => {
    const result = getNextBillingDate(base, BillingInterval.ANNUALLY);
    expect(result).toEqual(new Date('2027-03-07T00:00:00Z'));
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
yarn test -- --testPathPattern=billing.util
```
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create `src/common/utils/billing.util.ts`:

```typescript
import { BillingInterval } from '@prisma/client';

export function getNextBillingDate(
  from: Date,
  interval: BillingInterval,
): Date {
  const next = new Date(from);

  switch (interval) {
    case BillingInterval.DAILY:
      next.setDate(next.getDate() + 1);
      break;
    case BillingInterval.WEEKLY:
      next.setDate(next.getDate() + 7);
      break;
    case BillingInterval.MONTHLY:
      next.setMonth(next.getMonth() + 1);
      break;
    case BillingInterval.QUARTERLY:
      next.setMonth(next.getMonth() + 3);
      break;
    case BillingInterval.BI_ANNUALLY:
      next.setMonth(next.getMonth() + 6);
      break;
    case BillingInterval.ANNUALLY:
      next.setFullYear(next.getFullYear() + 1);
      break;
  }

  return next;
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
yarn test -- --testPathPattern=billing.util
```
Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add src/common/utils/
git commit -m "feat: add getNextBillingDate utility with tests"
```

---

### Task 5: Update CreateSubscriptionDto and SubscriptionsService

**Files:**
- Modify: `src/subscriptions/dto/create-subscription.dto.ts`
- Modify: `src/subscriptions/subscriptions.service.ts`

**Step 1: Update CreateSubscriptionDto**

Add `paymentMethod` field:

```typescript
import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'uuid-of-plan' })
  @IsString()
  planId: string;

  @ApiProperty({ enum: PaymentMethod, example: 'MPESA' })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
```

**Step 2: Update SubscriptionsService.create()**

In `src/subscriptions/subscriptions.service.ts`, add import:
```typescript
import { getNextBillingDate } from '../common/utils/billing.util';
```

Replace the `create()` method (lines 14-45):

```typescript
async create(memberId: string, dto: CreateSubscriptionDto) {
  const plan = await this.prisma.subscriptionPlan.findUnique({
    where: { id: dto.planId },
  });
  if (!plan) {
    throw new NotFoundException(
      `Subscription plan with id ${dto.planId} not found`,
    );
  }

  const startDate = new Date();
  const endDate = getNextBillingDate(startDate, plan.billingInterval);

  return this.prisma.memberSubscription.create({
    data: {
      primaryMemberId: memberId,
      planId: dto.planId,
      startDate,
      endDate,
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
}
```

**Step 3: Update SubscriptionsService.cancel()**

Replace the `cancel()` method (lines 159-180) — cancellation now sets `autoRenew: false` instead of immediately cancelling:

```typescript
async cancel(subscriptionId: string, requesterId: string) {
  const subscription = await this.prisma.memberSubscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    throw new NotFoundException(
      `Subscription with id ${subscriptionId} not found`,
    );
  }

  if (subscription.primaryMemberId !== requesterId) {
    throw new ForbiddenException(
      'Only the subscription owner can cancel the subscription',
    );
  }

  return this.prisma.memberSubscription.update({
    where: { id: subscriptionId },
    data: { autoRenew: false },
  });
}
```

**Step 4: Fix existing tests**

Update `src/subscriptions/subscriptions.service.spec.ts`. The existing tests should still pass since `hasActiveSubscription` hasn't changed. Run:

```bash
yarn test -- --testPathPattern=subscriptions
```

Fix any failures caused by the schema changes (mock updates if needed).

**Step 5: Commit**

```bash
git add src/subscriptions/ src/common/utils/
git commit -m "feat: update subscription creation for recurring billing"
```

---

### Task 6: Update PaymentsService — first payment, webhook with authorization code, and charge authorization

**Files:**
- Modify: `src/payments/payments.service.ts`

**Step 1: Refactor initializePayment()**

The payment initialization now creates a `Payment` record and passes `paymentMethod` context:

```typescript
async initializePayment(subscriptionId: string, email: string) {
  const subscription = await this.prisma.memberSubscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!subscription) throw new BadRequestException('Subscription not found');

  const payment = await this.prisma.payment.create({
    data: {
      subscriptionId,
      amount: subscription.plan.price,
      paymentMethod: subscription.paymentMethod,
    },
  });

  const response = await axios.post(
    `${this.paystackBaseUrl}/transaction/initialize`,
    {
      email,
      amount: subscription.plan.price * 100,
      currency: 'KES',
      reference: `gym_${payment.id}_${Date.now()}`,
      metadata: { subscriptionId, paymentId: payment.id },
    },
    {
      headers: {
        Authorization: `Bearer ${this.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
    },
  );
  return response.data.data;
}
```

**Step 2: Update handleWebhook() to save authorization code and advance billing**

```typescript
async handleWebhook(body: any, signature: string) {
  const hash = crypto
    .createHmac('sha512', this.paystackSecretKey)
    .update(JSON.stringify(body))
    .digest('hex');
  if (hash !== signature) throw new BadRequestException('Invalid signature');

  if (body.event === 'charge.success') {
    const { reference, metadata, authorization, channel } = body.data;
    const subscriptionId = metadata?.subscriptionId;
    const paymentId = metadata?.paymentId;

    if (paymentId) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          paystackReference: reference,
        },
      });
    }

    if (subscriptionId) {
      const subscription = await this.prisma.memberSubscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true },
      });

      if (subscription) {
        const nextBillingDate = getNextBillingDate(
          new Date(),
          subscription.plan.billingInterval,
        );

        const updateData: any = {
          status: 'ACTIVE',
          endDate: nextBillingDate,
          nextBillingDate,
        };

        // Save card authorization for future recurring charges
        if (
          channel === 'card' &&
          authorization?.authorization_code
        ) {
          updateData.paystackAuthorizationCode =
            authorization.authorization_code;
          updateData.paymentMethod = 'CARD';
        }

        await this.prisma.memberSubscription.update({
          where: { id: subscriptionId },
          data: updateData,
        });
      }
    }
  }

  if (body.event === 'charge.failed') {
    const { metadata, gateway_response } = body.data;
    const paymentId = metadata?.paymentId;

    if (paymentId) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'FAILED',
          failureReason: gateway_response || 'Payment failed',
        },
      });
    }
  }

  return { received: true };
}
```

Add import at top of file:
```typescript
import { getNextBillingDate } from '../common/utils/billing.util';
```

**Step 3: Add chargeAuthorization() method for recurring card charges**

```typescript
async chargeAuthorization(
  subscriptionId: string,
  authorizationCode: string,
  email: string,
  amount: number,
): Promise<Payment> {
  const payment = await this.prisma.payment.create({
    data: {
      subscriptionId,
      amount,
      paymentMethod: 'CARD',
    },
  });

  try {
    await axios.post(
      `${this.paystackBaseUrl}/transaction/charge_authorization`,
      {
        authorization_code: authorizationCode,
        email,
        amount: amount * 100,
        currency: 'KES',
        metadata: { subscriptionId, paymentId: payment.id },
      },
      {
        headers: {
          Authorization: `Bearer ${this.paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch {
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: 'Charge authorization request failed',
      },
    });
  }

  return payment;
}
```

**Step 4: Update getPaymentHistory() to use Payment table**

```typescript
async getPaymentHistory(memberId: string) {
  return this.prisma.payment.findMany({
    where: {
      subscription: { primaryMemberId: memberId },
    },
    include: { subscription: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
  });
}
```

**Step 5: Verify build**

Run:
```bash
yarn build
```

**Step 6: Commit**

```bash
git add src/payments/
git commit -m "feat: update payments for recurring billing - authorization codes, Payment table, charge authorization"
```

---

### Task 7: Create subscription reminder email template

**Files:**
- Create: `src/email/templates/subscription-reminder.hbs`
- Create: `src/email/templates/subscription-expired.hbs`
- Create: `src/email/templates/card-payment-failed.hbs`
- Modify: `src/email/email.service.ts`

**Step 1: Create reminder template**

`src/email/templates/subscription-reminder.hbs`:
```handlebars
{{> header}}

<h2>Hi {{firstName}},</h2>

<p>Your <strong>{{planName}}</strong> subscription {{#if isDueToday}}is due today{{else}}renews in {{daysUntil}} day{{#unless isSingleDay}}s{{/unless}}{{/if}}.</p>

<p>Amount: <strong>KES {{amount}}</strong></p>

{{> button url=paymentUrl text="Pay Now"}}

<p>If you don't renew, your access will be suspended when the subscription expires.</p>

{{> footer}}
```

**Step 2: Create expired template**

`src/email/templates/subscription-expired.hbs`:
```handlebars
{{> header}}

<h2>Hi {{firstName}},</h2>

<p>Your <strong>{{planName}}</strong> subscription has expired. Your gym access has been suspended.</p>

<p>Renew now to restore access:</p>

{{> button url=paymentUrl text="Renew Subscription"}}

{{> footer}}
```

**Step 3: Create card failure template**

`src/email/templates/card-payment-failed.hbs`:
```handlebars
{{> header}}

<h2>Hi {{firstName}},</h2>

<p>We were unable to charge your card for your <strong>{{planName}}</strong> subscription (KES {{amount}}).</p>

<p>Please update your payment method to keep your access active:</p>

{{> button url=paymentUrl text="Update Payment Method"}}

{{> footer}}
```

**Step 4: Add email helper methods to EmailService**

In `src/email/email.service.ts`, add these methods:

```typescript
async sendSubscriptionReminderEmail(
  to: string,
  firstName: string,
  planName: string,
  amount: number,
  daysUntil: number,
  paymentUrl: string,
): Promise<void> {
  await this.sendEmail(to, `Your ${planName} subscription renews soon`, 'subscription-reminder', {
    firstName,
    planName,
    amount,
    daysUntil,
    isDueToday: daysUntil === 0,
    isSingleDay: daysUntil === 1,
    paymentUrl,
  });
}

async sendSubscriptionExpiredEmail(
  to: string,
  firstName: string,
  planName: string,
  paymentUrl: string,
): Promise<void> {
  await this.sendEmail(to, `Your ${planName} subscription has expired`, 'subscription-expired', {
    firstName,
    planName,
    paymentUrl,
  });
}

async sendCardPaymentFailedEmail(
  to: string,
  firstName: string,
  planName: string,
  amount: number,
  paymentUrl: string,
): Promise<void> {
  await this.sendEmail(to, 'Payment failed - action required', 'card-payment-failed', {
    firstName,
    planName,
    amount,
    paymentUrl,
  });
}
```

**Step 5: Verify build**

Run:
```bash
yarn build
```

**Step 6: Commit**

```bash
git add src/email/
git commit -m "feat: add subscription reminder, expiry, and card failure email templates"
```

---

### Task 8: Create BillingService with daily cron job

This is the core engine. A new `billing` module with a service that runs daily.

**Files:**
- Create: `src/billing/billing.module.ts`
- Create: `src/billing/billing.service.ts`
- Modify: `src/app.module.ts`

**Step 1: Write the failing test**

Create `src/billing/billing.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';

describe('BillingService', () => {
  let service: BillingService;

  const mockPrisma = {
    memberSubscription: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      count: jest.fn(),
    },
  };

  const mockPaymentsService = {
    chargeAuthorization: jest.fn(),
  };

  const mockEmailService = {
    sendSubscriptionReminderEmail: jest.fn(),
    sendSubscriptionExpiredEmail: jest.fn(),
    sendCardPaymentFailedEmail: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({ adminUrl: 'http://localhost:3001' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processCardRenewals', () => {
    it('should charge card subscriptions due today', async () => {
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: 'AUTH_abc123',
        paymentMethod: 'CARD',
        autoRenew: true,
        nextBillingDate: new Date(),
        primaryMember: { id: 'u-1', email: 'test@test.com', firstName: 'John' },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([subscription]);
      mockPrisma.payment.count.mockResolvedValueOnce(0);
      mockPaymentsService.chargeAuthorization.mockResolvedValueOnce({ id: 'pay-1' });

      await service.processCardRenewals();

      expect(mockPaymentsService.chargeAuthorization).toHaveBeenCalledWith(
        'sub-1',
        'AUTH_abc123',
        'test@test.com',
        2500,
      );
    });

    it('should expire subscription after 2 consecutive card failures', async () => {
      const subscription = {
        id: 'sub-1',
        paystackAuthorizationCode: 'AUTH_abc123',
        paymentMethod: 'CARD',
        autoRenew: true,
        nextBillingDate: new Date(),
        primaryMember: { id: 'u-1', email: 'test@test.com', firstName: 'John' },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([subscription]);
      mockPrisma.payment.count.mockResolvedValueOnce(2); // 2 consecutive failures

      await service.processCardRenewals();

      expect(mockPrisma.memberSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'EXPIRED', autoRenew: false },
      });
      expect(mockEmailService.sendCardPaymentFailedEmail).toHaveBeenCalled();
    });
  });

  describe('processMpesaReminders', () => {
    it('should send reminder 3 days before billing date', async () => {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      const subscription = {
        id: 'sub-2',
        paymentMethod: 'MPESA',
        autoRenew: true,
        nextBillingDate: threeDaysFromNow,
        primaryMember: { id: 'u-2', email: 'mpesa@test.com', firstName: 'Jane' },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([subscription]);

      await service.processMpesaReminders();

      expect(mockEmailService.sendSubscriptionReminderEmail).toHaveBeenCalledWith(
        'mpesa@test.com',
        'Jane',
        'Monthly',
        2500,
        3,
        expect.stringContaining('/subscriptions'),
      );
    });
  });

  describe('expireOverdueSubscriptions', () => {
    it('should expire M-Pesa subscriptions past billing date with no payment', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const subscription = {
        id: 'sub-3',
        paymentMethod: 'MPESA',
        autoRenew: true,
        nextBillingDate: yesterday,
        primaryMember: { id: 'u-3', email: 'expired@test.com', firstName: 'Bob' },
        plan: { price: 2500, name: 'Monthly', billingInterval: 'MONTHLY' },
      };

      mockPrisma.memberSubscription.findMany.mockResolvedValueOnce([subscription]);

      await service.expireOverdueSubscriptions();

      expect(mockPrisma.memberSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-3' },
        data: { status: 'EXPIRED', autoRenew: false },
      });
      expect(mockEmailService.sendSubscriptionExpiredEmail).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
yarn test -- --testPathPattern=billing.service
```
Expected: FAIL — module not found.

**Step 3: Write BillingService implementation**

Create `src/billing/billing.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { AppConfig, getAppConfigName } from '../common/config/app.config';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly adminUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.adminUrl = this.configService.get<AppConfig>(getAppConfigName())!.adminUrl;
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleDailyBilling() {
    this.logger.log('Starting daily billing cycle');

    await this.processCardRenewals();
    await this.processMpesaReminders();
    await this.expireOverdueSubscriptions();

    this.logger.log('Daily billing cycle complete');
  }

  async processCardRenewals() {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const dueSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'ACTIVE',
        paymentMethod: 'CARD',
        autoRenew: true,
        paystackAuthorizationCode: { not: null },
        nextBillingDate: { lte: today },
      },
      include: {
        primaryMember: true,
        plan: true,
      },
    });

    for (const sub of dueSubscriptions) {
      // Check consecutive failures
      const recentFailures = await this.prisma.payment.count({
        where: {
          subscriptionId: sub.id,
          status: 'FAILED',
          createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
      });

      if (recentFailures >= 2) {
        await this.prisma.memberSubscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED', autoRenew: false },
        });
        await this.emailService.sendCardPaymentFailedEmail(
          sub.primaryMember.email,
          sub.primaryMember.firstName,
          sub.plan.name,
          sub.plan.price,
          `${this.adminUrl}/subscriptions`,
        );
        this.logger.warn(`Expired subscription ${sub.id} after 2 card failures`);
        continue;
      }

      await this.paymentsService.chargeAuthorization(
        sub.id,
        sub.paystackAuthorizationCode!,
        sub.primaryMember.email,
        sub.plan.price,
      );
      this.logger.log(`Charged card for subscription ${sub.id}`);
    }
  }

  async processMpesaReminders() {
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);
    threeDaysFromNow.setHours(23, 59, 59, 999);

    const upcomingSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'ACTIVE',
        paymentMethod: 'MPESA',
        autoRenew: true,
        nextBillingDate: { lte: threeDaysFromNow, gte: now },
      },
      include: {
        primaryMember: true,
        plan: true,
      },
    });

    for (const sub of upcomingSubscriptions) {
      const daysUntil = Math.ceil(
        (sub.nextBillingDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Send reminders at 3 days, 1 day, and 0 days (due today)
      if (daysUntil === 3 || daysUntil === 1 || daysUntil === 0) {
        await this.emailService.sendSubscriptionReminderEmail(
          sub.primaryMember.email,
          sub.primaryMember.firstName,
          sub.plan.name,
          sub.plan.price,
          daysUntil,
          `${this.adminUrl}/subscriptions`,
        );
        this.logger.log(
          `Sent M-Pesa reminder to ${sub.primaryMember.email} — ${daysUntil} days until billing`,
        );
      }
    }
  }

  async expireOverdueSubscriptions() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const overdueSubscriptions = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'ACTIVE',
        paymentMethod: 'MPESA',
        nextBillingDate: { lt: now },
      },
      include: {
        primaryMember: true,
        plan: true,
      },
    });

    for (const sub of overdueSubscriptions) {
      await this.prisma.memberSubscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED', autoRenew: false },
      });

      await this.emailService.sendSubscriptionExpiredEmail(
        sub.primaryMember.email,
        sub.primaryMember.firstName,
        sub.plan.name,
        `${this.adminUrl}/subscriptions`,
      );

      this.logger.log(`Expired overdue M-Pesa subscription ${sub.id}`);
    }
  }
}
```

**Step 4: Create BillingModule**

Create `src/billing/billing.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  providers: [BillingService],
})
export class BillingModule {}
```

**Step 5: Register BillingModule in AppModule**

In `src/app.module.ts`, add:
```typescript
import { BillingModule } from './billing/billing.module';
```

Add `BillingModule` to the `imports` array.

**Step 6: Run tests**

Run:
```bash
yarn test -- --testPathPattern=billing.service
```
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add src/billing/ src/app.module.ts
git commit -m "feat: add BillingService with daily cron for card charges and M-Pesa reminders"
```

---

### Task 9: Update seed data

**Files:**
- Modify: `prisma/seed.ts`

**Step 1: Update seed plans to use billingInterval instead of durationDays**

Replace any `durationDays` references with `billingInterval`. Example:

```typescript
await prisma.subscriptionPlan.create({
  data: {
    name: 'Monthly Plan',
    price: 2500,
    billingInterval: 'MONTHLY',
    description: 'Full gym access, billed monthly',
    maxMembers: 1,
  },
});

await prisma.subscriptionPlan.create({
  data: {
    name: 'Quarterly Plan',
    price: 6500,
    billingInterval: 'QUARTERLY',
    description: 'Full gym access, billed quarterly',
    maxMembers: 1,
  },
});

await prisma.subscriptionPlan.create({
  data: {
    name: 'Duo Monthly Plan',
    price: 4000,
    billingInterval: 'MONTHLY',
    description: 'Two members, billed monthly',
    maxMembers: 2,
  },
});
```

Update any seed subscriptions to include `paymentMethod`, `nextBillingDate`, and remove `paymentStatus`/`paystackReference`.

**Step 2: Reset and re-seed**

Run:
```bash
npx prisma migrate reset --force
```
This drops, recreates, runs all migrations, and seeds.

**Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: update seed data for recurring billing"
```

---

### Task 10: Update CLAUDE.md and run full test suite

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Run all tests**

```bash
yarn test
```
Expected: All tests pass. Fix any failures.

**Step 2: Run lint**

```bash
yarn lint
```
Expected: No errors.

**Step 3: Run build**

```bash
yarn build
```
Expected: Build succeeds.

**Step 4: Update CLAUDE.md**

Add to the **Modules** section:
```
- `billing/` — Daily cron job for recurring subscription billing. Auto-charges card users via Paystack authorization codes, sends email reminders to M-Pesa users. Expires overdue subscriptions.
```

Update the **Architecture** section to mention:
```
**Recurring Billing**: Self-managed billing cycle via daily cron (`@nestjs/schedule`). Card users are auto-charged via Paystack saved authorization codes. M-Pesa users receive email reminders and pay manually. `Payment` table tracks every charge attempt. See `docs/plans/2026-03-07-recurring-billing-design.md`.
```

Add `@nestjs/schedule` mention under any relevant env/tech notes.

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with recurring billing module"
```

---

## Task Dependency Graph

```
Task 1 (install schedule) ──┐
                             ├── Task 8 (BillingService + cron)
Task 2 (schema changes) ────┤
  ├── Task 3 (plan DTOs)     │
  ├── Task 4 (billing util)  │
  ├── Task 5 (subscription)──┤
  ├── Task 6 (payments) ─────┤
  └── Task 7 (email) ────────┘
                             │
                             ├── Task 9 (seed data)
                             └── Task 10 (verify + docs)
```

Tasks 1, 2 must go first. Tasks 3-7 can be done in any order after Task 2. Task 8 depends on Tasks 1, 5, 6, 7. Tasks 9-10 are final.
