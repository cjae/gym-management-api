# Shop Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `GET /shop/analytics` (summary snapshot) and `GET /shop/analytics/revenue` (time-series trend) endpoints for ADMIN+ users.

**Architecture:** Both methods live in `ShopService` and are exposed via two new `@Get` handlers in `ShopController`. Private helpers `getDateRange` and `getPeriodKey` are duplicated from `AnalyticsService` (they're small and keeping shop self-contained is worth it). The `AnalyticsQueryDto` and `Granularity` enum are imported from the analytics module — no duplication there. Tests use `jest-mock-extended` exactly as the rest of `shop.service.spec.ts`.

**Tech Stack:** NestJS 11, Prisma 6, Jest + jest-mock-extended, `@nestjs/swagger`

---

### Task 1: Add response DTOs

**Files:**
- Create: `src/shop/dto/shop-analytics-response.dto.ts`

**Step 1: Create the DTO file**

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class ShopAnalyticsOrdersDto {
  @ApiProperty() total: number;
  @ApiProperty() pending: number;
  @ApiProperty() paid: number;
  @ApiProperty() collected: number;
  @ApiProperty() cancelled: number;
}

export class ShopAnalyticsRevenueDto {
  @ApiProperty() allTime: number;
  @ApiProperty() thisMonth: number;
  @ApiProperty() lastMonth: number;
}

export class ShopTopItemDto {
  @ApiProperty() itemId: string;
  @ApiProperty() name: string;
  @ApiProperty() revenue: number;
  @ApiProperty() unitsSold: number;
}

export class ShopAnalyticsResponseDto {
  @ApiProperty({ type: ShopAnalyticsOrdersDto }) orders: ShopAnalyticsOrdersDto;
  @ApiProperty({ type: ShopAnalyticsRevenueDto }) revenue: ShopAnalyticsRevenueDto;
  @ApiProperty() avgOrderValue: number;
  @ApiProperty() unitsSold: number;
  @ApiProperty({ type: [ShopTopItemDto] }) topItems: ShopTopItemDto[];
  @ApiProperty() lowStockCount: number;
}

export class ShopRevenueByMethodDto {
  @ApiProperty() card: number;
  @ApiProperty() mobileMoney: number;
  @ApiProperty() bankTransfer: number;
  @ApiProperty() offline: number;
  @ApiProperty() complimentary: number;
}

export class ShopRevenuePeriodDto {
  @ApiProperty() period: string;
  @ApiProperty() revenue: number;
  @ApiProperty() orders: number;
  @ApiProperty({ type: ShopRevenueByMethodDto }) byMethod: ShopRevenueByMethodDto;
}

export class ShopRevenueTrendsResponseDto {
  @ApiProperty({ type: [ShopRevenuePeriodDto] }) series: ShopRevenuePeriodDto[];
}
```

**Step 2: Verify TypeScript is happy**

```bash
yarn tsc --noEmit 2>&1 | grep shop-analytics
```

Expected: no output (no errors).

**Step 3: Commit**

```bash
git add src/shop/dto/shop-analytics-response.dto.ts
git commit -m "feat(shop): add shop analytics response DTOs"
```

---

### Task 2: Write failing tests for `getShopAnalytics`

**Files:**
- Modify: `src/shop/shop.service.spec.ts`

Add a new `describe` block at the bottom of the file (before the closing `}`).

**Step 1: Add the failing tests**

```typescript
describe('getShopAnalytics', () => {
  const mockOrderItems = [
    {
      shopItemId: 'item-1',
      quantity: 3,
      unitPrice: 5000,
      item: { name: 'Gym Bag' },
    },
    {
      shopItemId: 'item-1',
      quantity: 2,
      unitPrice: 5000,
      item: { name: 'Gym Bag' },
    },
    {
      shopItemId: 'item-2',
      quantity: 1,
      unitPrice: 3000,
      item: { name: 'Water Bottle' },
    },
  ];

  beforeEach(() => {
    prisma.shopOrder.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(2)  // pending
      .mockResolvedValueOnce(5)  // paid
      .mockResolvedValueOnce(2)  // collected
      .mockResolvedValueOnce(1); // cancelled
    prisma.shopOrder.aggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: 50000 } } as any) // allTime
      .mockResolvedValueOnce({ _sum: { totalAmount: 10000 } } as any) // thisMonth
      .mockResolvedValueOnce({ _sum: { totalAmount: 8000 } } as any); // lastMonth
    (prisma.shopOrderItem.findMany as jest.Mock).mockResolvedValue(
      mockOrderItems,
    );
    prisma.shopItem.count.mockResolvedValue(2);       // low stock items
    prisma.shopItemVariant.count.mockResolvedValue(1); // low stock variants
  });

  it('returns order counts by status', async () => {
    const result = await service.getShopAnalytics();
    expect(result.orders).toEqual({
      total: 10,
      pending: 2,
      paid: 5,
      collected: 2,
      cancelled: 1,
    });
  });

  it('returns revenue figures for all-time, this month, and last month', async () => {
    const result = await service.getShopAnalytics();
    expect(result.revenue).toEqual({
      allTime: 50000,
      thisMonth: 10000,
      lastMonth: 8000,
    });
  });

  it('computes avgOrderValue from completed orders (paid + collected)', async () => {
    const result = await service.getShopAnalytics();
    // 5 paid + 2 collected = 7 completed; 50000 / 7 ≈ 7142.86
    expect(result.avgOrderValue).toBeCloseTo(50000 / 7, 2);
  });

  it('sums unitsSold from order items of completed orders', async () => {
    const result = await service.getShopAnalytics();
    expect(result.unitsSold).toBe(6); // 3 + 2 + 1
  });

  it('returns top 5 items sorted by revenue descending', async () => {
    const result = await service.getShopAnalytics();
    expect(result.topItems).toHaveLength(2);
    expect(result.topItems[0]).toMatchObject({
      itemId: 'item-1',
      name: 'Gym Bag',
      revenue: 25000, // (3 + 2) * 5000
      unitsSold: 5,
    });
    expect(result.topItems[1]).toMatchObject({
      itemId: 'item-2',
      name: 'Water Bottle',
      revenue: 3000,
      unitsSold: 1,
    });
  });

  it('sums low stock items and variants into lowStockCount', async () => {
    const result = await service.getShopAnalytics();
    expect(result.lowStockCount).toBe(3); // 2 items + 1 variant
  });

  it('returns avgOrderValue of 0 when no completed orders exist', async () => {
    // Reset mocks for this edge case
    jest.clearAllMocks();
    prisma.shopOrder.count
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(1) // pending
      .mockResolvedValueOnce(0) // paid
      .mockResolvedValueOnce(0) // collected
      .mockResolvedValueOnce(0); // cancelled
    prisma.shopOrder.aggregate
      .mockResolvedValue({ _sum: { totalAmount: null } } as any);
    (prisma.shopOrderItem.findMany as jest.Mock).mockResolvedValue([]);
    prisma.shopItem.count.mockResolvedValue(0);
    prisma.shopItemVariant.count.mockResolvedValue(0);

    const result = await service.getShopAnalytics();
    expect(result.avgOrderValue).toBe(0);
    expect(result.unitsSold).toBe(0);
    expect(result.topItems).toHaveLength(0);
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
yarn test -- --testPathPattern=shop.service -t "getShopAnalytics" 2>&1 | tail -20
```

Expected: FAIL — `service.getShopAnalytics is not a function`

---

### Task 3: Implement `getShopAnalytics` in ShopService

**Files:**
- Modify: `src/shop/shop.service.ts`

**Step 1: Add the `Granularity` import at the top** (needed by the private helpers added next)

```typescript
import { Granularity } from '../analytics/dto/analytics-query.dto';
```

**Step 2: Add private helpers and the new method** (place before the `@Cron` method)

```typescript
private getDateRange(query: { from?: string; to?: string }) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
  return { from, to };
}

private getPeriodKey(date: Date, granularity: Granularity): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  switch (granularity) {
    case Granularity.DAILY:
      return `${year}-${month}-${day}`;
    case Granularity.WEEKLY: {
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - date.getDay());
      const wMonth = String(startOfWeek.getMonth() + 1).padStart(2, '0');
      const wDay = String(startOfWeek.getDate()).padStart(2, '0');
      return `${startOfWeek.getFullYear()}-${wMonth}-${wDay}`;
    }
    case Granularity.MONTHLY:
      return `${year}-${month}`;
  }
}

async getShopAnalytics() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
  );

  const completedWhere = {
    status: { in: ['PAID', 'COLLECTED'] as const },
  };

  const [
    totalOrders,
    pendingOrders,
    paidOrders,
    collectedOrders,
    cancelledOrders,
    allTimeRevenueAgg,
    thisMonthRevenueAgg,
    lastMonthRevenueAgg,
    orderItems,
    lowStockItems,
    lowStockVariants,
  ] = await Promise.all([
    this.prisma.shopOrder.count(),
    this.prisma.shopOrder.count({ where: { status: 'PENDING' } }),
    this.prisma.shopOrder.count({ where: { status: 'PAID' } }),
    this.prisma.shopOrder.count({ where: { status: 'COLLECTED' } }),
    this.prisma.shopOrder.count({ where: { status: 'CANCELLED' } }),
    this.prisma.shopOrder.aggregate({
      _sum: { totalAmount: true },
      where: completedWhere,
    }),
    this.prisma.shopOrder.aggregate({
      _sum: { totalAmount: true },
      where: { ...completedWhere, createdAt: { gte: startOfMonth } },
    }),
    this.prisma.shopOrder.aggregate({
      _sum: { totalAmount: true },
      where: {
        ...completedWhere,
        createdAt: { gte: lastMonthStart, lte: lastMonthEnd },
      },
    }),
    this.prisma.shopOrderItem.findMany({
      where: { order: { status: { in: ['PAID', 'COLLECTED'] } } },
      select: {
        shopItemId: true,
        quantity: true,
        unitPrice: true,
        item: { select: { name: true } },
      },
    }),
    this.prisma.shopItem.count({ where: { stock: 0, isActive: true } }),
    this.prisma.shopItemVariant.count({
      where: { stock: 0, item: { isActive: true } },
    }),
  ]);

  const allTimeRevenue = allTimeRevenueAgg._sum.totalAmount ?? 0;
  const completedCount = paidOrders + collectedOrders;

  // Aggregate top items in-memory — realistic shop scale makes this fine
  const itemMap = new Map<
    string,
    { name: string; revenue: number; unitsSold: number }
  >();
  let unitsSold = 0;
  for (const oi of orderItems) {
    const entry = itemMap.get(oi.shopItemId) ?? {
      name: oi.item.name,
      revenue: 0,
      unitsSold: 0,
    };
    entry.revenue += oi.unitPrice * oi.quantity;
    entry.unitsSold += oi.quantity;
    itemMap.set(oi.shopItemId, entry);
    unitsSold += oi.quantity;
  }

  const topItems = Array.from(itemMap.entries())
    .map(([itemId, data]) => ({ itemId, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return {
    orders: {
      total: totalOrders,
      pending: pendingOrders,
      paid: paidOrders,
      collected: collectedOrders,
      cancelled: cancelledOrders,
    },
    revenue: {
      allTime: allTimeRevenue,
      thisMonth: thisMonthRevenueAgg._sum.totalAmount ?? 0,
      lastMonth: lastMonthRevenueAgg._sum.totalAmount ?? 0,
    },
    avgOrderValue:
      completedCount > 0
        ? Math.round((allTimeRevenue / completedCount) * 100) / 100
        : 0,
    unitsSold,
    topItems,
    lowStockCount: lowStockItems + lowStockVariants,
  };
}
```

**Step 3: Run the tests**

```bash
yarn test -- --testPathPattern=shop.service -t "getShopAnalytics" 2>&1 | tail -20
```

Expected: all 7 tests PASS.

**Step 4: Commit**

```bash
git add src/shop/shop.service.ts
git commit -m "feat(shop): implement getShopAnalytics service method"
```

---

### Task 4: Write failing tests for `getShopRevenueTrends`

**Files:**
- Modify: `src/shop/shop.service.spec.ts`

Add a new `describe` block after the `getShopAnalytics` block.

**Step 1: Add the import** at the top of the spec file:

```typescript
import { Granularity } from '../analytics/dto/analytics-query.dto';
```

**Step 2: Add the failing tests**

```typescript
describe('getShopRevenueTrends', () => {
  it('buckets PAID and COLLECTED orders by monthly period and payment method', async () => {
    (prisma.shopOrder.findMany as jest.Mock).mockResolvedValue([
      {
        totalAmount: 5000,
        paymentMethod: 'CARD',
        createdAt: new Date('2026-03-15'),
      },
      {
        totalAmount: 3000,
        paymentMethod: 'MOBILE_MONEY',
        createdAt: new Date('2026-03-20'),
      },
      {
        totalAmount: 2000,
        paymentMethod: 'CARD',
        createdAt: new Date('2026-04-01'),
      },
    ]);

    const result = await service.getShopRevenueTrends({
      granularity: Granularity.MONTHLY,
    });

    expect(result.series).toHaveLength(2);
    const march = result.series.find((s) => s.period === '2026-03')!;
    expect(march.revenue).toBe(8000);
    expect(march.orders).toBe(2);
    expect(march.byMethod.card).toBe(5000);
    expect(march.byMethod.mobileMoney).toBe(3000);
    expect(march.byMethod.bankTransfer).toBe(0);
  });

  it('returns series sorted chronologically', async () => {
    (prisma.shopOrder.findMany as jest.Mock).mockResolvedValue([
      {
        totalAmount: 1000,
        paymentMethod: 'CARD',
        createdAt: new Date('2026-04-01'),
      },
      {
        totalAmount: 2000,
        paymentMethod: 'CARD',
        createdAt: new Date('2026-02-01'),
      },
    ]);

    const result = await service.getShopRevenueTrends({
      granularity: Granularity.MONTHLY,
    });

    expect(result.series[0].period).toBe('2026-02');
    expect(result.series[1].period).toBe('2026-04');
  });

  it('returns empty series when no completed orders exist in range', async () => {
    (prisma.shopOrder.findMany as jest.Mock).mockResolvedValue([]);
    const result = await service.getShopRevenueTrends({});
    expect(result.series).toHaveLength(0);
  });

  it('passes the date range filter to Prisma', async () => {
    (prisma.shopOrder.findMany as jest.Mock).mockResolvedValue([]);
    await service.getShopRevenueTrends({
      from: '2026-01-01',
      to: '2026-03-31',
      granularity: Granularity.MONTHLY,
    });

    expect(prisma.shopOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({
            gte: new Date('2026-01-01'),
            lte: new Date('2026-03-31'),
          }),
        }),
      }),
    );
  });
});
```

**Step 3: Run to confirm they fail**

```bash
yarn test -- --testPathPattern=shop.service -t "getShopRevenueTrends" 2>&1 | tail -20
```

Expected: FAIL — `service.getShopRevenueTrends is not a function`

---

### Task 5: Implement `getShopRevenueTrends` in ShopService

**Files:**
- Modify: `src/shop/shop.service.ts`

**Step 1: Add the `AnalyticsQueryDto` import** at the top:

```typescript
import { AnalyticsQueryDto, Granularity } from '../analytics/dto/analytics-query.dto';
```

(Replace the `Granularity`-only import added in Task 3.)

**Step 2: Add the method** (place after `getShopAnalytics`)

```typescript
async getShopRevenueTrends(query: AnalyticsQueryDto) {
  const { from, to } = this.getDateRange(query);
  const granularity = query.granularity ?? Granularity.MONTHLY;

  const orders = await this.prisma.shopOrder.findMany({
    where: {
      status: { in: ['PAID', 'COLLECTED'] },
      createdAt: { gte: from, lte: to },
    },
    select: { totalAmount: true, paymentMethod: true, createdAt: true },
  });

  const buckets = new Map<
    string,
    {
      revenue: number;
      orders: number;
      card: number;
      mobileMoney: number;
      bankTransfer: number;
      offline: number;
      complimentary: number;
    }
  >();

  for (const order of orders) {
    const period = this.getPeriodKey(order.createdAt, granularity);
    if (!buckets.has(period)) {
      buckets.set(period, {
        revenue: 0,
        orders: 0,
        card: 0,
        mobileMoney: 0,
        bankTransfer: 0,
        offline: 0,
        complimentary: 0,
      });
    }
    const bucket = buckets.get(period)!;
    bucket.revenue += order.totalAmount;
    bucket.orders++;

    if (order.paymentMethod === 'CARD') bucket.card += order.totalAmount;
    else if (order.paymentMethod === 'MOBILE_MONEY')
      bucket.mobileMoney += order.totalAmount;
    else if (order.paymentMethod === 'BANK_TRANSFER')
      bucket.bankTransfer += order.totalAmount;
    else if (order.paymentMethod === 'OFFLINE')
      bucket.offline += order.totalAmount;
    else if (order.paymentMethod === 'COMPLIMENTARY')
      bucket.complimentary += order.totalAmount;
  }

  const series = Array.from(buckets.entries())
    .map(([period, data]) => ({
      period,
      revenue: data.revenue,
      orders: data.orders,
      byMethod: {
        card: data.card,
        mobileMoney: data.mobileMoney,
        bankTransfer: data.bankTransfer,
        offline: data.offline,
        complimentary: data.complimentary,
      },
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return { series };
}
```

**Step 3: Run the tests**

```bash
yarn test -- --testPathPattern=shop.service -t "getShopRevenueTrends" 2>&1 | tail -20
```

Expected: all 4 tests PASS.

**Step 4: Run full shop service test suite**

```bash
yarn test -- --testPathPattern=shop.service 2>&1 | tail -20
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/shop/shop.service.ts src/shop/shop.service.spec.ts
git commit -m "feat(shop): implement getShopRevenueTrends service method"
```

---

### Task 6: Add routes to ShopController

**Files:**
- Modify: `src/shop/shop.controller.ts`

**Step 1: Add DTO imports** at the top of the controller (add to existing import block):

```typescript
import { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import {
  ShopAnalyticsResponseDto,
  ShopRevenueTrendsResponseDto,
} from './dto/shop-analytics-response.dto';
```

**Step 2: Add the two route handlers** (place at the end of the controller class, before the closing `}`)

```typescript
// ── Analytics ──

@Get('analytics')
@UseGuards(RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@ApiOperation({
  summary: 'Get shop analytics summary',
  description:
    'Returns all-time order counts by status, revenue totals (all-time, this month, last month), average order value, units sold, top 5 items by revenue, and count of out-of-stock active items/variants.',
})
@ApiOkResponse({ type: ShopAnalyticsResponseDto })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
getShopAnalytics() {
  return this.shopService.getShopAnalytics();
}

@Get('analytics/revenue')
@UseGuards(RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@ApiOperation({
  summary: 'Get shop revenue trends',
  description:
    'Time-series shop revenue for PAID and COLLECTED orders, grouped by granularity (daily/weekly/monthly). Each period includes total revenue, order count, and breakdown by payment method. Defaults to the last 12 months, monthly.',
})
@ApiOkResponse({ type: ShopRevenueTrendsResponseDto })
@ApiForbiddenResponse({ description: 'Requires ADMIN or SUPER_ADMIN role' })
getShopRevenueTrends(@Query() query: AnalyticsQueryDto) {
  return this.shopService.getShopRevenueTrends(query);
}
```

**Step 3: Verify TypeScript**

```bash
yarn tsc --noEmit 2>&1 | grep -i shop
```

Expected: no output.

**Step 4: Commit**

```bash
git add src/shop/shop.controller.ts src/shop/dto/shop-analytics-response.dto.ts
git commit -m "feat(shop): add GET /shop/analytics and GET /shop/analytics/revenue endpoints"
```

---

### Task 7: Final checks

**Step 1: Lint**

```bash
yarn lint 2>&1 | tail -20
```

Expected: no errors (auto-fix applied).

**Step 2: Type check**

```bash
yarn tsc --noEmit 2>&1 | tail -20
```

Expected: no errors.

**Step 3: Full test suite**

```bash
yarn test 2>&1 | tail -20
```

Expected: all tests pass.

**Step 4: Push**

```bash
git push origin feature/shop
```
