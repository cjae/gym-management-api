# Shop Order Member Cancel — Design

**Date:** 2026-05-04

## Problem

When a member cancels payment on the Paystack WebView, the shop order stays `PENDING` and stock remains reserved for up to 1 hour until the hourly cron cleans it up. The mobile app intercepts the cancel redirect but has no endpoint to immediately release the stock.

## Solution

Add `POST /shop/orders/:id/cancel` — a member-facing endpoint the mobile app calls when it intercepts the Paystack cancel redirect. Immediately cancels the order and restores stock. The hourly cron remains as a safety net for crashes and connectivity failures.

## Design

### Endpoint

`POST /shop/orders/:id/cancel`

- Auth: `JwtAuthGuard` (any authenticated user)
- Ownership validated in the service — member can only cancel their own orders

### Service logic

`ShopService.cancelOrder(orderId, memberId)`:

1. Fetch the order — throw `404` if not found or `memberId` doesn't match
2. Throw `400` if status is not `PENDING`
3. In a single `$transaction`:
   - `updateMany` with `{ id: orderId, status: 'PENDING' }` guard (idempotency — same pattern as the cron)
   - If `count === 0`, throw `400` (race with cron — order already gone)
   - Restore stock for each line item (variant stock or item stock)

No notification sent — the mobile app initiated the cancel and already knows.

### Error handling

| Scenario | Response |
|---|---|
| Order not found / wrong member | `404 Not Found` |
| Order is `PAID` or already `CANCELLED` | `400 Bad Request` — "Order cannot be cancelled" |
| Race with cron (order vanishes mid-request) | `400 Bad Request` — "Order cannot be cancelled" |
| Stock restore fails mid-transaction | Transaction rolls back, order stays `PENDING`, cron recovers |

## Files changed

| File | Change |
|---|---|
| `src/shop/shop.controller.ts` | Add `POST /orders/:id/cancel` route |
| `src/shop/shop.service.ts` | Add `cancelOrder()` method |
| `src/shop/shop.service.spec.ts` | Add tests for `cancelOrder()` |
