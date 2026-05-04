# Shop Payment Push Notification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send a push notification to the member when a Paystack webhook confirms their shop order payment, so the mobile app knows to refresh the order status.

**Architecture:** Add `SHOP_ORDER_PAID` to the `NotificationType` enum, then call `NotificationsService.create()` inside `handlePaymentSuccess()` after the order flips to `PAID`. The call is fire-and-forget — a push failure never disrupts payment confirmation.

**Tech Stack:** NestJS, Prisma 6, `NotificationsService` (Expo push, already wired into `ShopService`)

---

### Task 1: Add SHOP_ORDER_PAID to the NotificationType enum

**Files:**
- Modify: `prisma/schema.prisma` (around line 89, inside the `NotificationType` enum)

**Step 1: Add the new enum value**

In `prisma/schema.prisma`, find the `NotificationType` enum and add `SHOP_ORDER_PAID` after `SHOP_ORDER_COLLECTED`:

```prisma
enum NotificationType {
  GENERAL
  STREAK_NUDGE
  STATUS_CHANGE
  PAYMENT_REMINDER
  SUBSCRIPTION_EXPIRING
  BIRTHDAY
  REFERRAL_REWARD
  CLASS_UPDATE
  EVENT_UPDATE
  MILESTONE
  GOAL_PLAN_READY
  GOAL_PLAN_FAILED
  GOAL_WEEKLY_PULSE
  SHOP_ORDER_COLLECTED
  SHOP_ORDER_PAID
}
```

**Step 2: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` — no errors.

**Step 3: Create and apply the migration**

```bash
npx prisma migrate dev --name add-shop-order-paid-notification-type
```

Expected: migration file created and applied successfully.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(shop): add SHOP_ORDER_PAID notification type"
```

---

### Task 2: Send push notification in handlePaymentSuccess

**Files:**
- Modify: `src/shop/shop.service.ts:367-387`
- Modify: `src/shop/shop.service.spec.ts:500-524`

**Step 1: Write the failing test**

In `src/shop/shop.service.spec.ts`, update the `handlePaymentSuccess` describe block to add a new test (add it after the existing "should update order to PAID" test):

```typescript
it('should send SHOP_ORDER_PAID push notification when order transitions to PAID', async () => {
  const notificationsService = module.get(NotificationsService);
  prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
  prisma.shopOrder.findUnique.mockResolvedValue({
    id: 'order-1',
    memberId: 'member-1',
    orderItems: [],
  } as any);

  await service.handlePaymentSuccess('order-1', 'ref_123');

  expect(notificationsService.create).toHaveBeenCalledWith({
    userId: 'member-1',
    title: 'Payment Confirmed',
    body: 'Your shop order has been received and is being prepared.',
    type: NotificationType.SHOP_ORDER_PAID,
    metadata: { orderId: 'order-1' },
  });
});
```

Also add `import { NotificationType } from '@prisma/client';` to the imports at the top of the spec file if it isn't already there.

**Step 2: Run the test to verify it fails**

```bash
yarn test -- --testPathPattern=shop.service -t "should send SHOP_ORDER_PAID"
```

Expected: FAIL — `notificationsService.create` not called.

**Step 3: Update handlePaymentSuccess in shop.service.ts**

Replace the current `handlePaymentSuccess` method (`src/shop/shop.service.ts:367-387`) with:

```typescript
async handlePaymentSuccess(orderId: string, reference: string) {
  const updated = await this.prisma.shopOrder.updateMany({
    where: { id: orderId, status: 'PENDING' },
    data: { status: 'PAID', paystackReference: reference },
  });

  if (updated.count === 0) {
    this.logger.warn(
      `shop.payment.success: order ${orderId} not PENDING or already processed`,
    );
    return;
  }

  const order = await this.prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });
  if (order) {
    await this.checkAndNotifyLowStock(order.orderItems);

    this.notificationsService
      .create({
        userId: order.memberId,
        title: 'Payment Confirmed',
        body: 'Your shop order has been received and is being prepared.',
        type: NotificationType.SHOP_ORDER_PAID,
        metadata: { orderId },
      })
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send shop payment notification for order ${orderId}: ${err.message}`,
        ),
      );
  }
}
```

Also add `NotificationType` to the import from `@prisma/client` at the top of `shop.service.ts` if it isn't already imported (it is — check line 25).

**Step 4: Run the new test to verify it passes**

```bash
yarn test -- --testPathPattern=shop.service -t "should send SHOP_ORDER_PAID"
```

Expected: PASS.

**Step 5: Run the full shop service test suite**

```bash
yarn test -- --testPathPattern=shop.service
```

Expected: all tests pass.

**Step 6: Run full checks**

```bash
yarn lint && yarn build
```

Expected: no errors.

**Step 7: Commit**

```bash
git add src/shop/shop.service.ts src/shop/shop.service.spec.ts
git commit -m "feat(shop): send push notification when shop order payment confirmed"
```

---

## Done

The mobile app will now receive a `SHOP_ORDER_PAID` push notification within seconds of payment confirmation. The notification `metadata.orderId` lets the app navigate directly to the correct order screen and refresh its status.
