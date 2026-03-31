# Optional Payment Reference for Admin Subscriptions

**Date**: 2026-03-31

## Problem

Admins must provide a payment reference when creating offline subscriptions (except COMPLIMENTARY). Sometimes the reference isn't available at creation time (e.g., bank transfer pending, M-Pesa code not yet received).

## Changes

### 1. Make `paymentReference` optional in `AdminCreateSubscriptionDto`

Remove the `@ValidateIf` + `@IsNotEmpty` conditional requirement. The field becomes fully optional for all admin payment methods. The Payment record is created with `paystackReference: null` when omitted.

### 2. New endpoint: `PATCH /subscriptions/:id/payment-reference`

- **Access**: ADMIN, SUPER_ADMIN
- **DTO**: `UpdatePaymentReferenceDto` with required `paymentReference: string` (max 200 chars)
- **Behavior**:
  - Find the subscription by ID, 404 if not found
  - Verify the subscription uses an admin/offline payment method (reject if it's a Paystack-processed CARD or MOBILE_MONEY subscription)
  - Find the latest Payment record for that subscription
  - Update `paystackReference` on that payment
- **No new Prisma migration needed** — `paystackReference` is already `String?` on Payment

### What doesn't change

Paystack-processed subscriptions (online card/M-Pesa) are untouched. Their payment references are set by the webhook and cannot be modified via this endpoint.

## Access Control

Any ADMIN or SUPER_ADMIN can update the payment reference, not just the original creator.
