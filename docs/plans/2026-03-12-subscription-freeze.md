# Subscription Freeze Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow members to temporarily freeze their subscription, blocking check-in and extending the subscription end date by actual frozen days.

**Architecture:** Add `maxFreezeDays` to SubscriptionPlan, add freeze state fields to MemberSubscription, add FROZEN to SubscriptionStatus enum. New freeze/unfreeze endpoints on the subscriptions controller. Daily cron auto-unfreezes expired freezes.

**Tech Stack:** NestJS, Prisma 6, PostgreSQL, Jest

---

### Task 1: Schema Changes

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add FROZEN to SubscriptionStatus enum**

In `prisma/schema.prisma`, update the SubscriptionStatus enum:

```prisma
enum SubscriptionStatus {
  ACTIVE
  FROZEN
  EXPIRED
  CANCELLED
}
```

**Step 2: Add maxFreezeDays to SubscriptionPlan model**

Add after the `maxMembers` field (line 110):

```prisma
  maxFreezeDays Int      @default(0)
```

**Step 3: Add freeze fields to MemberSubscription model**

Add after the `nextBillingDate` field (line 128):

```prisma
  freezeStartDate           DateTime?
  freezeEndDate             DateTime?
  frozenDaysUsed            Int           @default(0)
```

**Step 4: Create and apply migration**

Run: `npx prisma migrate dev --name add-subscription-freeze`
Expected: Migration created and applied successfully.

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add subscription freeze fields and FROZEN status"
```

---

### Task 2: Update Plan DTOs

**Files:**
- Modify: `src/subscription-plans/dto/create-plan.dto.ts`
- Modify: `src/subscription-plans/dto/update-plan.dto.ts`
- Modify: `src/subscription-plans/dto/subscription-plan-response.dto.ts`

**Step 1: Add maxFreezeDays to CreatePlanDto**

Add at the end of the class in `src/subscription-plans/dto/create-plan.dto.ts`:

```typescript
  @ApiPropertyOptional({ example: 20, description: 'Max freeze days per billing cycle. 0 = freeze not available.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxFreezeDays?: number;
```

**Step 2: Add maxFreezeDays to UpdatePlanDto**

Add at the end of the class in `src/subscription-plans/dto/update-plan.dto.ts`:

```typescript
  @ApiPropertyOptional({ example: 20, description: 'Max freeze days per billing cycle. 0 = freeze not available.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxFreezeDays?: number;
```

**Step 3: Add maxFreezeDays to SubscriptionPlanResponseDto**

Add at the end of the class in `src/subscription-plans/dto/subscription-plan-response.dto.ts`:

```typescript
  @ApiProperty({ example: 20 })
  maxFreezeDays: number;
```

**Step 4: Commit**

```bash
git add src/subscription-plans/dto/
git commit -m "feat(plans): add maxFreezeDays to plan DTOs"
```

---

### Task 3: Create Freeze DTO and Update Subscription Response DTO

**Files:**
- Create: `src/subscriptions/dto/freeze-subscription.dto.ts`
- Modify: `src/subscriptions/dto/subscription-response.dto.ts`

**Step 1: Create FreezeSubscriptionDto**

Create `src/subscriptions/dto/freeze-subscription.dto.ts`:

```typescript
import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FreezeSubscriptionDto {
  @ApiProperty({ example: 10, description: 'Number of days to freeze (1 to plan maxFreezeDays)' })
  @IsInt()
  @Min(1)
  days: number;
}
```

**Step 2: Update SubscriptionResponseDto**

Add freeze fields and update the status enum in `src/subscriptions/dto/subscription-response.dto.ts`:

Change the status property enum from `['ACTIVE', 'EXPIRED', 'CANCELLED']` to `['ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED']`.

Add these fields before the `createdAt` property:

```typescript
  @ApiPropertyOptional()
  freezeStartDate?: Date;

  @ApiPropertyOptional()
  freezeEndDate?: Date;

  @ApiProperty({ example: 0 })
  frozenDaysUsed: number;
```

**Step 3: Commit**

```bash
git add src/subscriptions/dto/
git commit -m "feat(subscriptions): add freeze DTO and update response DTO"
```

---

### Task 4: Implement Freeze/Unfreeze Service Methods

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts`

**Step 1: Add freeze method**

Add to `SubscriptionsService` class after the `cancel` method:

```typescript
  async freeze(subscriptionId: string, requesterId: string, requesterRole: string, days: number) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        primaryMember: { select: { firstName: true, lastName: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription with id ${subscriptionId} not found`);
    }

    const isOwner = subscription.primaryMemberId === requesterId;
    const isAdmin = requesterRole === 'ADMIN' || requesterRole === 'SUPER_ADMIN';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Only the subscription owner or an admin can freeze the subscription');
    }

    if (subscription.status !== 'ACTIVE') {
      throw new BadRequestException('Only active subscriptions can be frozen');
    }

    if (subscription.plan.maxFreezeDays === 0) {
      throw new BadRequestException('This plan does not support freezing');
    }

    if (days > subscription.plan.maxFreezeDays) {
      throw new BadRequestException(`Freeze duration cannot exceed ${subscription.plan.maxFreezeDays} days`);
    }

    if (subscription.frozenDaysUsed > 0) {
      throw new BadRequestException('Freeze already used this billing cycle');
    }

    const freezeStartDate = new Date();
    const freezeEndDate = new Date();
    freezeEndDate.setDate(freezeEndDate.getDate() + days);

    const result = await this.prisma.memberSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'FROZEN',
        freezeStartDate,
        freezeEndDate,
      },
      include: { plan: true },
    });

    const memberName = `${subscription.primaryMember.firstName} ${subscription.primaryMember.lastName}`;
    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `${memberName} froze their ${subscription.plan.name} subscription for ${days} days`,
      timestamp: new Date().toISOString(),
      metadata: { subscriptionId, planName: subscription.plan.name, status: 'FROZEN', days },
    });

    return result;
  }
```

**Step 2: Add unfreeze method**

Add after the `freeze` method:

```typescript
  async unfreeze(subscriptionId: string, requesterId: string, requesterRole: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        primaryMember: { select: { firstName: true, lastName: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription with id ${subscriptionId} not found`);
    }

    const isOwner = subscription.primaryMemberId === requesterId;
    const isAdmin = requesterRole === 'ADMIN' || requesterRole === 'SUPER_ADMIN';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Only the subscription owner or an admin can unfreeze the subscription');
    }

    if (subscription.status !== 'FROZEN') {
      throw new BadRequestException('Only frozen subscriptions can be unfrozen');
    }

    const actualFrozenDays = Math.ceil(
      (new Date().getTime() - subscription.freezeStartDate!.getTime()) / (1000 * 60 * 60 * 24),
    );
    const frozenDays = Math.max(1, actualFrozenDays);

    const newEndDate = new Date(subscription.endDate);
    newEndDate.setDate(newEndDate.getDate() + frozenDays);

    const newNextBillingDate = subscription.nextBillingDate
      ? new Date(subscription.nextBillingDate)
      : null;
    if (newNextBillingDate) {
      newNextBillingDate.setDate(newNextBillingDate.getDate() + frozenDays);
    }

    const result = await this.prisma.memberSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'ACTIVE',
        endDate: newEndDate,
        nextBillingDate: newNextBillingDate,
        freezeStartDate: null,
        freezeEndDate: null,
        frozenDaysUsed: frozenDays,
      },
      include: { plan: true },
    });

    const memberName = `${subscription.primaryMember.firstName} ${subscription.primaryMember.lastName}`;
    this.eventEmitter.emit('activity.subscription', {
      type: 'subscription',
      description: `${memberName} unfroze their ${subscription.plan.name} subscription (${frozenDays} days used)`,
      timestamp: new Date().toISOString(),
      metadata: { subscriptionId, planName: subscription.plan.name, status: 'ACTIVE', frozenDays },
    });

    return result;
  }
```

**Step 3: Update hasActiveSubscription to exclude FROZEN**

In the `hasActiveSubscription` method (line 119-131), the query already checks `status: 'ACTIVE'` which naturally excludes FROZEN. No change needed.

**Step 4: Commit**

```bash
git add src/subscriptions/subscriptions.service.ts
git commit -m "feat(subscriptions): implement freeze and unfreeze service methods"
```

---

### Task 5: Add Controller Endpoints

**Files:**
- Modify: `src/subscriptions/subscriptions.controller.ts`

**Step 1: Add freeze and unfreeze endpoints**

Import `FreezeSubscriptionDto` and `CurrentUser` already exists. Add `Roles` decorator usage.

Add after the `cancel` endpoint:

```typescript
  @Patch(':id/freeze')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Not subscription owner or admin' })
  @ApiBadRequestResponse({ description: 'Cannot freeze this subscription' })
  freeze(
    @Param('id') id: string,
    @Body() dto: FreezeSubscriptionDto,
    @CurrentUser('id') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    return this.subscriptionsService.freeze(id, requesterId, requesterRole, dto.days);
  }

  @Patch(':id/unfreeze')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Not subscription owner or admin' })
  @ApiBadRequestResponse({ description: 'Subscription is not frozen' })
  unfreeze(
    @Param('id') id: string,
    @CurrentUser('id') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    return this.subscriptionsService.unfreeze(id, requesterId, requesterRole);
  }
```

Import `FreezeSubscriptionDto` at the top of the file.

**Step 2: Commit**

```bash
git add src/subscriptions/subscriptions.controller.ts
git commit -m "feat(subscriptions): add freeze and unfreeze controller endpoints"
```

---

### Task 6: Auto-Unfreeze Cron Job

**Files:**
- Modify: `src/billing/billing.service.ts`

**Step 1: Add auto-unfreeze cron method**

Add a new cron method to `BillingService` after `handleMpesaReminders`:

```typescript
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleAutoUnfreeze() {
    this.logger.log('Starting auto-unfreeze check');
    await this.autoUnfreezeSubscriptions();
    this.logger.log('Auto-unfreeze check complete');
  }

  async autoUnfreezeSubscriptions() {
    const now = new Date();

    const expiredFreezes = await this.prisma.memberSubscription.findMany({
      where: {
        status: 'FROZEN',
        freezeEndDate: { lte: now },
      },
    });

    for (const sub of expiredFreezes) {
      const frozenDays = Math.ceil(
        (sub.freezeEndDate!.getTime() - sub.freezeStartDate!.getTime()) / (1000 * 60 * 60 * 24),
      );

      const newEndDate = new Date(sub.endDate);
      newEndDate.setDate(newEndDate.getDate() + frozenDays);

      const newNextBillingDate = sub.nextBillingDate
        ? new Date(sub.nextBillingDate)
        : null;
      if (newNextBillingDate) {
        newNextBillingDate.setDate(newNextBillingDate.getDate() + frozenDays);
      }

      await this.prisma.memberSubscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          endDate: newEndDate,
          nextBillingDate: newNextBillingDate,
          freezeStartDate: null,
          freezeEndDate: null,
          frozenDaysUsed: frozenDays,
        },
      });

      this.logger.log(`Auto-unfroze subscription ${sub.id} after ${frozenDays} frozen days`);
    }
  }
```

**Step 2: Commit**

```bash
git add src/billing/billing.service.ts
git commit -m "feat(billing): add auto-unfreeze cron for expired subscription freezes"
```

---

### Task 7: Reset frozenDaysUsed on Billing Renewal

**Files:**
- Modify: `src/billing/billing.service.ts`

**Step 1: Reset frozenDaysUsed in processCardRenewals**

In the `processCardRenewals` method, after a successful charge (around line 108), the billing renewal logic managed by the webhook handler typically extends the subscription. Since renewals are handled via the Paystack webhook which updates the subscription dates, we need to reset `frozenDaysUsed` there.

However, looking at the architecture, the simpler approach is to reset `frozenDaysUsed` inside the `autoUnfreezeSubscriptions` method is not right — we need it when the billing cycle renews, i.e., when `nextBillingDate` is advanced.

The cleanest approach: reset `frozenDaysUsed` to 0 whenever the subscription's `nextBillingDate` is updated (which happens in the payments webhook). Let's add the reset to the card renewal charge flow since that's where `nextBillingDate` advances.

In `processCardRenewals`, after the `chargeAuthorization` call (line 103-108), add `frozenDaysUsed: 0` to any subscription date advancement that occurs in the webhook handler.

Check `src/payments/payments.service.ts` for the webhook handler that advances `nextBillingDate`.

**Step 2: Investigate webhook handler**

Read `src/payments/payments.service.ts` to find where `nextBillingDate` is advanced and add `frozenDaysUsed: 0` to that update.

**Step 3: Commit**

```bash
git add src/payments/
git commit -m "feat(billing): reset frozenDaysUsed on subscription renewal"
```

---

### Task 8: Write Tests for Freeze/Unfreeze

**Files:**
- Modify: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Add freeze tests**

Add to the existing spec file after the `hasActiveSubscription` describe block:

```typescript
  describe('freeze', () => {
    const mockSubscription = {
      id: 'sub-1',
      primaryMemberId: 'user-1',
      status: 'ACTIVE',
      endDate: new Date('2026-04-01'),
      nextBillingDate: new Date('2026-04-01'),
      frozenDaysUsed: 0,
      freezeStartDate: null,
      freezeEndDate: null,
      plan: { id: 'plan-1', name: 'Monthly', maxFreezeDays: 20 },
      primaryMember: { firstName: 'John', lastName: 'Doe' },
    };

    it('should freeze an active subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(mockSubscription);
      mockPrisma.memberSubscription.update.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'FROZEN',
      });

      const result = await service.freeze('sub-1', 'user-1', 'MEMBER', 10);
      expect(result.status).toBe('FROZEN');
    });

    it('should reject freeze when plan does not support it', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        plan: { ...mockSubscription.plan, maxFreezeDays: 0 },
      });

      await expect(service.freeze('sub-1', 'user-1', 'MEMBER', 5))
        .rejects.toThrow('This plan does not support freezing');
    });

    it('should reject freeze when days exceed plan max', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(mockSubscription);

      await expect(service.freeze('sub-1', 'user-1', 'MEMBER', 25))
        .rejects.toThrow('Freeze duration cannot exceed 20 days');
    });

    it('should reject freeze when already used this cycle', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        frozenDaysUsed: 10,
      });

      await expect(service.freeze('sub-1', 'user-1', 'MEMBER', 5))
        .rejects.toThrow('Freeze already used this billing cycle');
    });

    it('should reject freeze on non-active subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'EXPIRED',
      });

      await expect(service.freeze('sub-1', 'user-1', 'MEMBER', 5))
        .rejects.toThrow('Only active subscriptions can be frozen');
    });

    it('should allow admin to freeze another members subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(mockSubscription);
      mockPrisma.memberSubscription.update.mockResolvedValueOnce({
        ...mockSubscription,
        status: 'FROZEN',
      });

      const result = await service.freeze('sub-1', 'admin-1', 'ADMIN', 10);
      expect(result.status).toBe('FROZEN');
    });

    it('should reject freeze from non-owner non-admin', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(mockSubscription);

      await expect(service.freeze('sub-1', 'other-user', 'MEMBER', 5))
        .rejects.toThrow('Only the subscription owner or an admin can freeze');
    });
  });

  describe('unfreeze', () => {
    it('should unfreeze and extend end date by actual frozen days', async () => {
      const freezeStart = new Date();
      freezeStart.setDate(freezeStart.getDate() - 5);
      const freezeEnd = new Date();
      freezeEnd.setDate(freezeEnd.getDate() + 5);

      const frozenSub = {
        id: 'sub-1',
        primaryMemberId: 'user-1',
        status: 'FROZEN',
        endDate: new Date('2026-04-01'),
        nextBillingDate: new Date('2026-04-01'),
        frozenDaysUsed: 0,
        freezeStartDate: freezeStart,
        freezeEndDate: freezeEnd,
        plan: { id: 'plan-1', name: 'Monthly', maxFreezeDays: 20 },
        primaryMember: { firstName: 'John', lastName: 'Doe' },
      };

      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce(frozenSub);
      mockPrisma.memberSubscription.update.mockImplementationOnce(({ data }) => {
        return Promise.resolve({ ...frozenSub, ...data });
      });

      const result = await service.unfreeze('sub-1', 'user-1', 'MEMBER');
      expect(result.status).toBe('ACTIVE');
      expect(result.frozenDaysUsed).toBeGreaterThanOrEqual(5);
    });

    it('should reject unfreeze on non-frozen subscription', async () => {
      mockPrisma.memberSubscription.findUnique.mockResolvedValueOnce({
        id: 'sub-1',
        primaryMemberId: 'user-1',
        status: 'ACTIVE',
        plan: { maxFreezeDays: 20 },
        primaryMember: { firstName: 'John', lastName: 'Doe' },
      });

      await expect(service.unfreeze('sub-1', 'user-1', 'MEMBER'))
        .rejects.toThrow('Only frozen subscriptions can be unfrozen');
    });
  });
```

**Step 2: Run tests**

Run: `yarn test -- --testPathPattern=subscriptions`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/subscriptions/subscriptions.service.spec.ts
git commit -m "test(subscriptions): add freeze and unfreeze unit tests"
```

---

### Task 9: Update CLAUDE.md and Run Lint

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

In the `subscriptions/` bullet under **Modules**, add freeze info:

Change from:
`subscriptions/` — Member subscriptions with duo support (2 members share 1 subscription via `SubscriptionMember` join table)

To:
`subscriptions/` — Member subscriptions with duo support and freeze capability. Members can freeze their subscription (up to plan's `maxFreezeDays` per billing cycle), blocking check-in and extending the end date by actual frozen days on unfreeze. One freeze per billing cycle. Auto-unfreeze via daily cron.

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 3: Run all tests**

Run: `yarn test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with subscription freeze feature"
```
