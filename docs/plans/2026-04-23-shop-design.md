# Shop Module Design

**Date**: 2026-04-23
**Status**: Approved

## Overview

A gym shop where members purchase physical items (merchandise, supplements, accessories) via the mobile app (Paystack) or at the gym counter (admin-recorded). Items are picked up at the gym entrance; admin marks orders as collected.

## Data Models

### GymSettings (updated)
Add `currency String @default("KES")` — deployment-level currency config, sourced by all shop operations. Exposed via existing `GET /gym-settings` and `PATCH /gym-settings` endpoints.

### ShopItem
```
id          UUID PK
name        String
description String?
price       Float         — base price in gym currency
imageUrl    String?       — Cloudinary URL
isActive    Boolean       @default(true)
stock       Int           — used when no variants exist
createdAt   DateTime
updatedAt   DateTime
→ ShopItemVariant[]
```

### ShopItemVariant
```
id            UUID PK
shopItemId    FK → ShopItem
name          String        — e.g. "Large", "Chocolate"
priceOverride Float?        — overrides item base price if set
stock         Int
createdAt     DateTime
updatedAt     DateTime
```

### ShopOrder
```
id                 UUID PK
memberId           FK → User
status             Enum: PENDING | PAID | COLLECTED | CANCELLED
totalAmount        Float
currency           String     — snapshotted from GymSettings at purchase time
paymentMethod      PaymentMethod (existing enum)
paystackReference  String? @unique
createdAt          DateTime
updatedAt          DateTime
→ ShopOrderItem[]
```

### ShopOrderItem
```
id          UUID PK
shopOrderId FK → ShopOrder
shopItemId  FK → ShopItem
variantId   FK → ShopItemVariant (nullable)
quantity    Int
unitPrice   Float   — snapshotted at purchase time
createdAt   DateTime
```

## Purchase Flows

### Online (member via app)
1. Member browses active items, selects item/variant + quantity
2. `POST /shop/orders` creates order (status: PENDING), decrements stock, initialises Paystack checkout
3. Paystack webhook fires `charge.success` → EventEmitter routes to ShopService → order → PAID
4. Admin sees order in pending-collection queue, marks collected → COLLECTED
5. Member receives push notification on collection
6. On failure or 1-hour cleanup cron → CANCELLED, stock restored

### Counter sale (admin)
1. `POST /shop/orders/admin` creates order with offline payment method
2. Order created directly as PAID + COLLECTED — no Paystack involved
3. Stock decremented immediately

## Webhook Routing

Paystack supports one webhook URL. The existing `/api/payments/webhook` is extended with a `metadata.type` discriminator:
- `type: 'subscription'` → existing subscription logic (unchanged)
- `type: 'shop'` → emits `shop.payment.success` event via EventEmitter; ShopService listener handles order fulfilment

No new webhook endpoint. No direct coupling between PaymentsService and ShopService.

## Stock Management

- Stock decremented **at order creation** (optimistic, prevents overselling during checkout)
- Restored on cancellation or payment failure
- When any item/variant stock reaches 0 after a decrement, email all ADMIN + SUPER_ADMIN users via existing EmailService

## API Endpoints

### Admin (ADMIN + SUPER_ADMIN)
```
POST   /shop/items                          — create item
GET    /shop/items                          — list all items (paginated, filter active/inactive)
GET    /shop/items/:id                      — item detail
PATCH  /shop/items/:id                      — update item
DELETE /shop/items/:id                      — SUPER_ADMIN only

POST   /shop/items/:id/variants             — add variant
PATCH  /shop/items/:id/variants/:vid        — update variant
DELETE /shop/items/:id/variants/:vid        — remove variant

POST   /shop/orders/admin                   — record counter sale
GET    /shop/orders                         — list all orders (filter status/member/date)
PATCH  /shop/orders/:id/collect             — mark as COLLECTED
```

### Member
```
GET    /shop/items              — list active items only
GET    /shop/items/:id          — item detail
POST   /shop/orders             — create order + Paystack checkout
GET    /shop/orders/mine        — own order history (paginated)
GET    /shop/orders/:id         — single order (own orders only)
```

## Feature Gating

Licensed feature key: `shop`. Uses existing `@RequiresFeature('shop')` decorator + global `FeatureGuard`. Dev mode enables by default.

## Images

Item images uploaded via existing `POST /uploads/image` (Cloudinary). The returned URL is stored as `imageUrl` on `ShopItem`. No new upload infrastructure needed.

## Security

- Members can only read/create their own orders (IDOR protection via `memberId === req.user.id`)
- `unitPrice` and `currency` snapshotted at order creation — immune to price/settings changes
- Paystack webhook verified via existing HMAC SHA-512 signature check
- Stock decrement uses conditional increment (`updateMany` with `stock > 0` where clause) to prevent race conditions
