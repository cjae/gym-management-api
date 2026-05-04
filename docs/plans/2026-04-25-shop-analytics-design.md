# Shop Analytics — Design

**Date:** 2026-04-25
**Branch:** feature/shop

## Problem

Admins have no visibility into how the gym shop is performing. The existing shop module exposes order management but no aggregated view of revenue, volume, or inventory health.

## Decision

Add two endpoints to `ShopController` following the same split used in `AnalyticsController`:

- `GET /shop/analytics` — snapshot summary (all-time totals + fixed windows)
- `GET /shop/analytics/revenue` — time-series revenue trend with date range + granularity

Both are gated by `@RequiresFeature('shop')` and restricted to ADMIN/SUPER_ADMIN.

## Endpoints

### GET /shop/analytics

No query params. Returns a snapshot covering all-time totals and fixed windows (this month / last month).

```json
{
  "orders": {
    "total": 120,
    "pending": 5,
    "paid": 30,
    "collected": 80,
    "cancelled": 5
  },
  "revenue": {
    "allTime": 450000,
    "thisMonth": 62000,
    "lastMonth": 48000
  },
  "avgOrderValue": 3750,
  "unitsSold": 340,
  "topItems": [
    { "itemId": "...", "name": "Gym Bag", "revenue": 90000, "unitsSold": 60 }
  ],
  "lowStockCount": 3
}
```

- `revenue` counts PAID + COLLECTED orders only
- `avgOrderValue` = allTime revenue / count of PAID + COLLECTED orders
- `unitsSold` = sum of `ShopOrderItem.quantity` across PAID + COLLECTED orders
- `topItems` = top 5 items by revenue (PAID + COLLECTED orders), joined to `ShopItem.name`
- `lowStockCount` = count of `ShopItem` + `ShopItemVariant` records where `stock === 0` and `isActive === true`

### GET /shop/analytics/revenue

Accepts `AnalyticsQueryDto`: `from`, `to`, `granularity` (daily/weekly/monthly). Defaults: range = last 12 months, granularity = monthly.

```json
{
  "series": [
    {
      "period": "2026-03",
      "revenue": 48000,
      "orders": 14,
      "byMethod": { "card": 30000, "mobileMoney": 18000, "bankTransfer": 0, "offline": 0, "complimentary": 0 }
    }
  ]
}
```

- Buckets on `ShopOrder.createdAt` for PAID + COLLECTED orders only
- `orders` = count of orders in the period (volume alongside revenue)
- `byMethod` covers all `PaymentMethod` values the shop accepts

## Implementation

**No schema changes.**

- `ShopService`: add `getShopAnalytics()` and `getShopRevenueTrends(query: AnalyticsQueryDto)`
- Reuse `AnalyticsQueryDto`, `Granularity`, `getDateRange()`, `getPeriodKey()` imported from `../analytics/dto/analytics-query.dto` and `AnalyticsService`
- `ShopController`: two new `@Get` handlers
- New DTOs: `ShopAnalyticsResponseDto`, `ShopRevenueTrendsResponseDto`
- Unit tests: one describe block per service method in `shop.service.spec.ts`

## Out of Scope

- Per-item trend breakdown (can be added later)
- Export (covered by the existing exports module)
- Real-time WebSocket push for shop events
