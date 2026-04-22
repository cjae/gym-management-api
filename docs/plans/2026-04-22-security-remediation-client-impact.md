# Security Remediation — Client & Ops Impact Log

Running log of API contract and operational changes from the security audit remediation. Surface any entry here to frontend/mobile teams and ops before deploying.

## Format

Each batch entry captures:
- **API contract changes** — request/response/schema changes frontends must handle
- **Operational / deployment changes** — env vars, migrations, behavior ops should expect
- **Subtle behavior changes** — things that *look* the same externally but differ in edge cases

---

## PR 1 — Critical batch (C1–C4)

**Shipped:** 2026-04-22
**Findings fixed:** C1 (JWT fail-closed), C2 (timing-safe HMAC), C3 (atomic webhook idempotency), C4 (require `ENCRYPTION_KEY`)

### API contract changes

**None.** All controller/DTO shapes are unchanged. Webhooks still return `{ received: true }` with status 200 and throw `BadRequestException('Invalid signature')` with the identical message. No mobile or admin client changes required.

### Operational / deployment changes

| Change | Action required |
|---|---|
| `JWT_SECRET` now required outside `NODE_ENV=development`/`test` | Set in staging, production, preview, and any other deployed env. App **throws at boot** if unset. Fallback `'dev-secret'` no longer applies in these envs. |
| `JWT_REFRESH_SECRET` now required outside `NODE_ENV=development`/`test` | Same as above. Fallback `'dev-refresh-secret'` no longer applies. |
| `ENCRYPTION_KEY` now required outside `NODE_ENV=development`/`test` | Must be a 32-byte hex string (64 hex chars). Used for AES-256-GCM on `paystackAuthorizationCode`. App **throws at boot** if unset in prod/staging. |

**Checklist before deploying PR 1:**
- [ ] Confirm `JWT_SECRET` set in prod & staging (existing installs likely already have this — verify)
- [ ] Confirm `JWT_REFRESH_SECRET` set in prod & staging
- [ ] Confirm `ENCRYPTION_KEY` set in prod & staging (this is the new one — most likely to be missing)
- [ ] `NODE_ENV=production` (or `staging`) is set explicitly — relying on unset NODE_ENV will now fail at boot

### Subtle behavior changes (no action needed, but be aware)

1. **Duplicate Paystack webhooks are now a silent 2xx no-op.** Before: parallel webhook deliveries for the same reference could double-apply subscription extensions / referral rewards / discount redemptions. After: the first atomic claim wins; subsequent claims return 200 without touching side effects. Paystack retry semantics are unchanged.
2. **`charge.success` webhook without `metadata.paymentId` is now logged + ignored** instead of partially processed. Paystack always sends our metadata back, so this only matters for malformed/manual test payloads.
3. **Legacy plaintext `paystackAuthorizationCode` rows will self-heal.** The billing cron (daily, `Africa/Nairobi`) will try to decrypt; on failure it nulls the field and logs a warning. Affected members must re-authorize on their next billing cycle. **Expect a short burst of `"Failed to decrypt"` warnings after the first post-deploy cron run** — this is expected, not an incident. No data migration required.
4. **In dev/test without `ENCRYPTION_KEY`, the webhook now skips persisting the auth code** (logs a warning) instead of storing plaintext. Billing cron in that environment cannot auto-charge those subs — by design. Only affects local dev.

### Files changed
- `src/common/config/auth.config.ts` — C1
- `src/common/config/payment.config.ts` — C4 config-load enforcement
- `src/payments/payments.service.ts` — C2, C3, C4 write path
- `src/billing/billing.service.ts` — C4 read path self-heal
- `src/common/config/auth.config.spec.ts` (new), `src/payments/payments.service.spec.ts`, `src/billing/billing.service.spec.ts` — test coverage

### Known follow-ups (not in this PR)

Flagged by the implementing agents, tracked separately:
- `processReferralReward` runs fire-and-forget outside the claim transaction. If the server crashes between the claim and the referral write, the reward is *dropped* (not duplicated — the claim is idempotent). Addressed in PR 2 via H13.
- `PAYSTACK_SECRET_KEY` and `ENCRYPTION_KEY` enforcement patterns now diverge slightly from other configs — candidate for a shared helper in a future cleanup.

---

## PR 2 — Race conditions (H6, H9, H10, H11, H12, H13, M14, M15)

**Shipped:** 2026-04-22
**Findings fixed:** 6 High + 2 Medium. All "check-then-write" TOCTOU races replaced with atomic SQL claims (`updateMany` with guard clauses) inside transactions.

### API contract changes

**None.** All endpoints, DTOs, response shapes, and error messages preserved verbatim. Admin and mobile clients require no code changes.

### Operational / deployment changes

**Two new Prisma migrations** — must run before the new code ships. Both include data backfills.

| Migration | Change | Deploy impact |
|---|---|---|
| `20260422000000_add_gym_class_enrolled_count` | Adds `enrolledCount INT NOT NULL DEFAULT 0` to `GymClass`. Backfills from existing `ClassEnrollment` rows. | Near-instant on a small table. Internal counter only — not exposed in API responses (those still use `_count.enrollments`). |
| `20260422120000_add_discount_redemption_counter` | Creates `DiscountRedemptionCounter (discountCodeId, memberId, uses)` with unique index on `(discountCodeId, memberId)`. Backfills by joining existing `DiscountRedemption` against `SubscriptionMember` so per-member benefit counts are correct post-migration. | Size scales with redemption history × duo members. Run before code deploy. |

**Deploy checklist for PR 2:**
- [ ] Run `npx prisma migrate deploy` on staging → verify counters match expected values
- [ ] Run same on production in a maintenance window (or during low-traffic hours)
- [ ] Then deploy the new application code

### Subtle behavior changes (visible to clients — **flag these to mobile/admin teams**)

1. **Duo discount bypass closed.** Previously, if member A (primary) redeemed a discount code on a duo subscription shared with member B, member B could later re-use the same code on their own subscription. This was **unintended** — `maxUsesPerMember` should count "benefits," not just "redeemer attributions." After PR 2, member B will see the standard `"You have already used this discount code the maximum number of times"` error. **Any existing duo members who have been relying on this bypass will find they can no longer stack the code.** Expect minor support volume.
2. **Password reset replay closed.** If a reset-token link is clicked twice (tab duplication, email client prefetch), only the first request succeeds. Second sees `"Invalid or expired reset token"`. Mobile should not retry on this error — it's terminal.
3. **Same-day multi-entrance check-in is now fully silent.** Previously, scanning at a second entrance on the same day returned "already checked in" but could still touch streak / emit activity events in edge races. Now it's a true no-op — no streak update, no activity event, no push. Admin activity feed will see one event per member per day, not two.
4. **Class full is now deterministic.** Enrollment attempts hitting a class at capacity get `ConflictException('Class is full')` atomically — no more intermittent oversells that succeed on race wins. Mobile "class full" UI should work correctly in all cases now.
5. **Referral reward is atomic with webhook activation.** Previously, a server crash between webhook claim and referral reward dropped the reward silently (finding noted in PR 1). Now both commit together or neither does. Paystack retries a failed webhook, so the net effect is eventual consistency — referrer gets their reward; no double-rewards possible.

### Files changed (14 files, ~1,300 insertions)

**Code:**
- `src/auth/auth.service.ts` — H6
- `src/attendance/attendance.service.ts` — M14
- `src/discount-codes/discount-codes.service.ts` — H9, H10
- `src/goals/listeners/goal-generation.listener.ts` — M15
- `src/gym-classes/gym-classes.service.ts` — H12
- `src/payments/payments.service.ts` — H13 (referral reward moved into webhook tx)
- `src/subscriptions/subscriptions.service.ts` — H11

**Schema:**
- `prisma/schema.prisma` — `GymClass.enrolledCount` field, new `DiscountRedemptionCounter` model

**Migrations:**
- `prisma/migrations/20260422000000_add_gym_class_enrolled_count/`
- `prisma/migrations/20260422120000_add_discount_redemption_counter/`

**Specs:** matching `.spec.ts` for every file above.

### Known follow-ups (not in this PR)

- `GymClassesService.update` allows lowering `maxCapacity` below current `enrolledCount` (retroactive oversell). Low risk — admin-only action.
- `GymClassesService.remove` is a soft-delete that doesn't zero `enrolledCount`. If a class is ever re-activated, the counter will be stale. Not currently possible via API.
- `goals.service.ts` `retryGeneration` and `update` have non-atomic status transitions — tight race window, low exploitability, not in audit scope.
- `goal-generation.listener.spec.ts:130` has a pre-existing `no-useless-catch` lint error unrelated to the audit.

---
