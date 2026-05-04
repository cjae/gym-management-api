# Shop Payment Push Notification — Design

**Date:** 2026-05-04

## Problem

When a member pays for a shop order via the Paystack WebView, the WebView intercepts the callback URL and navigates the user back to the app. At that point the order is still `PENDING` because the Paystack webhook hasn't been processed yet. The app has no reliable signal for when the order transitions to `PAID`.

## Solution

Send a push notification to the member when the Paystack webhook confirms payment. The existing Expo push notification infrastructure handles delivery.

## Scope

Shop orders only. Subscription payments are unaffected — the subscription is applied automatically and the member sees it on next refresh.

## Design

### 1. Schema change

Add `SHOP_ORDER_PAID` to the `NotificationType` enum in `prisma/schema.prisma`.

### 2. API change

In `ShopService.handlePaymentSuccess()`, after the `updateMany` guard confirms the order flipped from `PENDING` to `PAID`, fetch the order's `memberId` and call `notificationsService.create()`:

```
title:    "Payment Confirmed"
body:     "Your shop order has been received and is being prepared."
type:     SHOP_ORDER_PAID
metadata: { orderId }
```

The call is fire-and-forget — a `.catch()` logs the error but does not re-throw, so a push failure never disrupts the payment confirmation itself.

### 3. Mobile app (informational — not in this repo)

- When the WebView closes, issue a single one-shot re-fetch of the order. If already `PAID`, done.
- If still `PENDING`, show a "Confirming payment…" state and wait for the `SHOP_ORDER_PAID` push notification to arrive, then refresh.

## Error handling & edge cases

| Scenario | Behaviour |
|---|---|
| No push token registered | In-app notification record is still created; visible in the notifications list |
| Duplicate webhook | `updateMany` guard is idempotent; notification only fires when `count > 0` |
| Push delivery delayed | One-shot re-fetch on WebView close catches fast confirmations; push handles the slow path |

## Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `SHOP_ORDER_PAID` to `NotificationType` enum |
| `src/shop/shop.service.ts` | Call `notificationsService.create()` in `handlePaymentSuccess()` |
| `src/shop/shop.service.spec.ts` | Add test for push notification on payment success |
