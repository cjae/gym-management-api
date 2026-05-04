# Shop Order Member Cancel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `POST /shop/orders/:id/cancel` so the mobile app can immediately cancel a PENDING shop order (and restore stock) when a member cancels payment on the Paystack WebView.

**Architecture:** One new service method `cancelOrder(orderId, memberId)` that validates ownership, checks status, then atomically cancels the order and restores stock inside a `$transaction` using an `updateMany` idempotency guard (matching the existing cron pattern). One new controller route wrapping it. The hourly cron remains unchanged as a safety net.

**Tech Stack:** NestJS, Prisma 6, Jest + jest-mock-extended

---

### Task 1: Add cancelOrder() to ShopService (TDD)

**Files:**
- Modify: `src/shop/shop.service.ts` — add `cancelOrder()` method before `findAllOrders()`
- Modify: `src/shop/shop.service.spec.ts` — add `describe('cancelOrder')` block

**Step 1: Confirm baseline tests pass**

```bash
yarn test -- --testPathPattern=shop.service
```

Expected: all 27 tests pass.

**Step 2: Write failing tests**

In `src/shop/shop.service.spec.ts`, add this describe block after the `describe('collectOrder')` block (after line 418):

```typescript
describe('cancelOrder', () => {
  it('should throw NotFoundException when order not found', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue(null);
    await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
      'Order not found',
    );
  });

  it('should throw NotFoundException when order belongs to another member', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      memberId: 'other-member',
      status: 'PENDING',
      orderItems: [],
    } as any);
    await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
      'Order not found',
    );
  });

  it('should throw BadRequestException when order is not PENDING', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      memberId: 'member-1',
      status: 'PAID',
      orderItems: [],
    } as any);
    await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
      'Order cannot be cancelled',
    );
  });

  it('should throw BadRequestException when order is already CANCELLED', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      memberId: 'member-1',
      status: 'CANCELLED',
      orderItems: [],
    } as any);
    await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
      'Order cannot be cancelled',
    );
  });

  it('should cancel order and restore variant stock', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      memberId: 'member-1',
      status: 'PENDING',
      orderItems: [
        { shopItemId: 'item-1', variantId: 'variant-1', quantity: 2 },
      ],
    } as any);
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopItemVariant.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelOrder('order-1', 'member-1');

    expect(prisma.shopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.shopItemVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 'variant-1' },
      data: { stock: { increment: 2 } },
    });
  });

  it('should cancel order and restore item stock when no variant', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      memberId: 'member-1',
      status: 'PENDING',
      orderItems: [
        { shopItemId: 'item-1', variantId: null, quantity: 3 },
      ],
    } as any);
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.shopItem.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelOrder('order-1', 'member-1');

    expect(prisma.shopItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { stock: { increment: 3 } },
    });
  });

  it('should throw BadRequestException when cron races and cancels first', async () => {
    prisma.shopOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      memberId: 'member-1',
      status: 'PENDING',
      orderItems: [],
    } as any);
    prisma.shopOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancelOrder('order-1', 'member-1')).rejects.toThrow(
      'Order cannot be cancelled',
    );
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
yarn test -- --testPathPattern=shop.service -t "cancelOrder"
```

Expected: FAIL — `service.cancelOrder is not a function`.

**Step 4: Implement cancelOrder() in shop.service.ts**

Add this method before `findAllOrders()` (around line 511):

```typescript
async cancelOrder(orderId: string, memberId: string) {
  const order = await this.prisma.shopOrder.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });

  if (!order || order.memberId !== memberId) {
    throw new NotFoundException('Order not found');
  }

  if (order.status !== 'PENDING') {
    throw new BadRequestException('Order cannot be cancelled');
  }

  await this.prisma.$transaction(async (tx) => {
    const result = await tx.shopOrder.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    if (result.count === 0) {
      throw new BadRequestException('Order cannot be cancelled');
    }

    for (const item of order.orderItems) {
      if (item.variantId) {
        await tx.shopItemVariant.updateMany({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      } else {
        await tx.shopItem.updateMany({
          where: { id: item.shopItemId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
  });
}
```

**Step 5: Run cancelOrder tests**

```bash
yarn test -- --testPathPattern=shop.service -t "cancelOrder"
```

Expected: all 7 new tests pass.

**Step 6: Run full shop service suite**

```bash
yarn test -- --testPathPattern=shop.service
```

Expected: all 34 tests pass.

**Step 7: Commit**

```bash
git add src/shop/shop.service.ts src/shop/shop.service.spec.ts
git commit -m "feat(shop): add cancelOrder service method with stock restore"
```

---

### Task 2: Add POST /orders/:id/cancel to ShopController

**Files:**
- Modify: `src/shop/shop.controller.ts` — add route after `findMyOrder` (around line 228)

**Step 1: Add the route**

In `src/shop/shop.controller.ts`, add this block after the `findMyOrder` handler (after line 228, before the `collectOrder` handler):

```typescript
@Post('orders/:id/cancel')
@UseGuards(RolesGuard)
@Roles('MEMBER')
@ApiOkResponse({ description: 'Order cancelled successfully' })
@ApiNotFoundResponse({ description: 'Order not found' })
@ApiBadRequestResponse({ description: 'Order cannot be cancelled' })
@ApiForbiddenResponse({ description: 'Requires MEMBER role' })
cancelOrder(
  @Param('id', ParseUUIDPipe) orderId: string,
  @CurrentUser('id') memberId: string,
) {
  return this.shopService.cancelOrder(orderId, memberId);
}
```

**Step 2: Run lint and build**

```bash
yarn lint && yarn build
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/shop/shop.controller.ts
git commit -m "feat(shop): add POST /shop/orders/:id/cancel endpoint"
```

---

## Done

The mobile app calls `POST /shop/orders/:id/cancel` (with the member's JWT) immediately when the Paystack WebView cancel redirect is intercepted. Stock is restored instantly. The hourly cron remains as a safety net for crashes/connectivity failures.
