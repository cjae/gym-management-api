# Optional Payment Reference — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admins to create offline subscriptions without a payment reference and update it later.

**Architecture:** Two changes to the subscriptions module — relax DTO validation and add a new PATCH endpoint. No schema migration needed since `paystackReference` is already nullable on `Payment`.

**Tech Stack:** NestJS, class-validator, Prisma, Jest + jest-mock-extended

---

### Task 1: Make paymentReference optional in AdminCreateSubscriptionDto

**Files:**
- Modify: `src/subscriptions/dto/admin-create-subscription.dto.ts:37-43`

**Step 1: Update the DTO**

Remove the `@ValidateIf` and `@IsNotEmpty` decorators from `paymentReference`. Replace with `@IsOptional`. Update the `@ApiProperty` to `@ApiPropertyOptional` and adjust the description.

```typescript
@ApiPropertyOptional({
  example: 'QWERTY123',
  maxLength: 200,
  description:
    'Payment reference (e.g., M-Pesa transaction code, bank transfer ref). Optional — can be added later via PATCH.',
})
@IsOptional()
@IsString()
@MaxLength(200)
paymentReference?: string;
```

Remove the `ValidateIf` and `IsNotEmpty` imports from `class-validator` if they are no longer used in this file.

**Step 2: Run lint and tests**

Run: `yarn lint && yarn test -- --testPathPattern=subscriptions`
Expected: All pass — existing tests use `paymentReference` in their DTOs so they still work. The field is just no longer required.

**Step 3: Commit**

```bash
git add src/subscriptions/dto/admin-create-subscription.dto.ts
git commit -m "feat(subscriptions): make paymentReference optional for admin subscription creation"
```

---

### Task 2: Write failing tests for updatePaymentReference

**Files:**
- Modify: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Add tests for the new `updatePaymentReference` method**

Add a new `describe('updatePaymentReference')` block after the existing `adminCreate` tests. Write these test cases:

```typescript
describe('updatePaymentReference', () => {
  const subscriptionId = 'sub-1';
  const paymentReference = 'MPESA-TXN-NEW123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update payment reference on the latest payment', async () => {
    prisma.memberSubscription.findUnique.mockResolvedValueOnce({
      id: subscriptionId,
      paymentMethod: 'MOBILE_MONEY_IN_PERSON',
    } as any);
    prisma.payment.findFirst.mockResolvedValueOnce({
      id: 'pay-1',
      subscriptionId,
      paystackReference: null,
    } as any);
    prisma.payment.update.mockResolvedValueOnce({
      id: 'pay-1',
      paystackReference: paymentReference,
    } as any);

    const result = await service.updatePaymentReference(
      subscriptionId,
      paymentReference,
    );

    expect(result.paystackReference).toBe(paymentReference);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { paystackReference: paymentReference },
    });
  });

  it('should throw NotFoundException if subscription not found', async () => {
    prisma.memberSubscription.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.updatePaymentReference(subscriptionId, paymentReference),
    ).rejects.toThrow('Subscription with id sub-1 not found');
  });

  it('should throw BadRequestException for non-offline payment method', async () => {
    prisma.memberSubscription.findUnique.mockResolvedValueOnce({
      id: subscriptionId,
      paymentMethod: 'CARD',
    } as any);

    await expect(
      service.updatePaymentReference(subscriptionId, paymentReference),
    ).rejects.toThrow(
      'Payment reference can only be updated for offline/in-person subscriptions',
    );
  });

  it('should throw NotFoundException if no payment found for subscription', async () => {
    prisma.memberSubscription.findUnique.mockResolvedValueOnce({
      id: subscriptionId,
      paymentMethod: 'BANK_TRANSFER_IN_PERSON',
    } as any);
    prisma.payment.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updatePaymentReference(subscriptionId, paymentReference),
    ).rejects.toThrow('No payment found for subscription sub-1');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=subscriptions`
Expected: FAIL — `service.updatePaymentReference is not a function`

---

### Task 3: Implement updatePaymentReference in SubscriptionsService

**Files:**
- Modify: `src/subscriptions/subscriptions.service.ts`

**Step 1: Add the import for ADMIN_PAYMENT_METHODS**

At the top of the file, add:

```typescript
import { ADMIN_PAYMENT_METHODS } from '../common/constants/payment-methods';
```

**Step 2: Add the `updatePaymentReference` method**

Add after the `adminCreate` method (after the `return safe;` block around line 316):

```typescript
async updatePaymentReference(
  subscriptionId: string,
  paymentReference: string,
) {
  const subscription = await this.prisma.memberSubscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, paymentMethod: true },
  });

  if (!subscription) {
    throw new NotFoundException(
      `Subscription with id ${subscriptionId} not found`,
    );
  }

  if (
    !ADMIN_PAYMENT_METHODS.includes(subscription.paymentMethod as any)
  ) {
    throw new BadRequestException(
      'Payment reference can only be updated for offline/in-person subscriptions',
    );
  }

  const payment = await this.prisma.payment.findFirst({
    where: { subscriptionId },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) {
    throw new NotFoundException(
      `No payment found for subscription ${subscriptionId}`,
    );
  }

  return this.prisma.payment.update({
    where: { id: payment.id },
    data: { paystackReference: paymentReference },
  });
}
```

**Step 3: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=subscriptions`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/subscriptions/subscriptions.service.ts src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat(subscriptions): add updatePaymentReference service method with tests"
```

---

### Task 4: Add DTO and controller endpoint

**Files:**
- Create: `src/subscriptions/dto/update-payment-reference.dto.ts`
- Modify: `src/subscriptions/subscriptions.controller.ts`

**Step 1: Create the DTO**

```typescript
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePaymentReferenceDto {
  @ApiProperty({
    example: 'MPESA-TXN-ABC123',
    maxLength: 200,
    description: 'Payment reference (e.g., M-Pesa transaction code, bank transfer ref)',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  paymentReference: string;
}
```

**Step 2: Add the controller endpoint**

In `subscriptions.controller.ts`, import the new DTO:

```typescript
import { UpdatePaymentReferenceDto } from './dto/update-payment-reference.dto';
```

Add the endpoint after the `adminCreate` method (after line 68):

```typescript
@Patch(':id/payment-reference')
@Roles('ADMIN', 'SUPER_ADMIN')
@ApiOkResponse({ description: 'Payment reference updated' })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
@ApiNotFoundResponse({ description: 'Subscription or payment not found' })
@ApiBadRequestResponse({
  description: 'Cannot update payment reference for online subscriptions',
})
updatePaymentReference(
  @Param('id') id: string,
  @Body() dto: UpdatePaymentReferenceDto,
) {
  return this.subscriptionsService.updatePaymentReference(
    id,
    dto.paymentReference,
  );
}
```

**Step 3: Run lint and full tests**

Run: `yarn lint && yarn test -- --testPathPattern=subscriptions`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/subscriptions/dto/update-payment-reference.dto.ts src/subscriptions/subscriptions.controller.ts
git commit -m "feat(subscriptions): add PATCH endpoint for updating payment reference"
```

---

### Task 5: Add test for adminCreate without paymentReference

**Files:**
- Modify: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Add a test verifying adminCreate works without paymentReference**

Inside the existing `describe('adminCreate')` block, add:

```typescript
it('should create subscription without paymentReference', async () => {
  prisma.user.findUnique.mockResolvedValueOnce(mockMember as any);
  prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(
    mockPlanActive as any,
  );
  prisma.subscriptionMember.findFirst.mockResolvedValueOnce(null);
  prisma.memberSubscription.findFirst.mockResolvedValueOnce(null);

  const createdSub = {
    id: 'sub-1',
    primaryMemberId: 'member-1',
    planId: 'plan-1',
    status: 'ACTIVE',
    paymentMethod: 'MOBILE_MONEY_IN_PERSON',
    plan: mockPlanActive,
    members: [{ memberId: 'member-1' }],
  };
  prisma.memberSubscription.create.mockResolvedValueOnce(createdSub as any);
  prisma.payment.create.mockResolvedValueOnce({ id: 'pay-1' } as any);

  const dto = {
    memberId: 'member-1',
    planId: 'plan-1',
    paymentMethod: PaymentMethod.MOBILE_MONEY_IN_PERSON,
    // no paymentReference
  };

  const result = await service.adminCreate(adminId, dto);

  expect(result.status).toBe('ACTIVE');
  expect(prisma.payment.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        paystackReference: undefined,
      }),
    }),
  );
});
```

**Step 2: Run tests**

Run: `yarn test -- --testPathPattern=subscriptions`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/subscriptions/subscriptions.service.spec.ts
git commit -m "test(subscriptions): add test for adminCreate without paymentReference"
```

---

### Task 6: Final verification

**Step 1: Run full lint + type check + tests**

Run: `yarn lint && yarn build && yarn test`
Expected: All PASS, no type errors, no lint warnings

**Step 2: Commit design + plan docs if not already committed**

```bash
git add docs/plans/2026-03-31-optional-payment-reference-design.md docs/plans/2026-03-31-optional-payment-reference-plan.md
git commit -m "docs: add design and plan for optional payment reference"
```
