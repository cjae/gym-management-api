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

## PR 3 — Data exposure / hygiene (H1–H5, H8, M1, M2, M5, M10, M13, M16, M18)

**Shipped:** 2026-04-22
**Findings fixed:** 4 High + 9 Medium. Hardening of auth, diagnostics, billing, bootstrap, and I/O resilience. H7 declared wontfix (see audit tracker for justification). 16/17 Critical+High closed; H7 is not a defect.

### API contract changes (flag to mobile/admin teams)

1. **New `403 Forbidden` from `JwtAuthGuard` when `mustChangePassword=true`.**
   Admin-created users (temp-password flow) now receive:
   ```
   403 { "message": "Password change required. Please change your temporary password to continue." }
   ```
   on every authenticated endpoint **except** the allowlist: `GET /auth/me`, `PATCH /auth/change-password`, `POST /auth/logout`. Mobile and admin clients must catch this error and route the user to the change-password screen. Previously the flag was advisory-only (surfaced in `TokenResponseDto.mustChangePassword`) — now it's enforced server-side.
2. **JWT payload gains `mustChangePassword: boolean` claim** on both access and refresh tokens. Clients already receive this field in the response body — the claim is additive, no decoding change required.
3. **WebSocket `/activity` no longer accepts connections from arbitrary origins.** Browser clients must connect from an origin listed in `ADMIN_URL` (comma-separated). Native mobile apps (React Native / Expo) send no Origin header and are unaffected.
4. **Swagger UI (`/api/docs`, `/api/docs-json`) requires Basic Auth** in staging/production. Reuses the existing `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` creds. Dev/test remain open.

### Operational / deployment changes

**One new Prisma migration** — must run before the new code ships.

| Migration | Change | Deploy impact |
|---|---|---|
| `20260422130000_add_subscription_billing_flag` | Adds nullable `MemberSubscription.billingFlaggedAt DateTime?` (set by billing cron when auth-code decrypt fails, so ops can review). | Adds-only, no backfill. Safe to run online. |

| Change | Action required |
|---|---|
| `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD` now required outside dev/test | Set in staging, production, preview. App **throws at boot** if either is missing or empty. Mirrors JWT/ENCRYPTION_KEY pattern from PR 1. |
| `TRUST_PROXY_HOPS` env var (optional, default `1`) | Set to match your reverse-proxy topology. `1` is safe for a single proxy (Nginx, Heroku router). Behind multiple proxy layers (e.g., CloudFront → ALB → app), set to `2`. Too low: rate-limiter under-keys; too high: clients can spoof `X-Forwarded-For`. |
| `NODE_ENV=production` now enforces strict Prisma SSL (`rejectUnauthorized: true`) | If the prod Postgres uses a self-signed cert, connections will start failing. **Ops follow-up:** bundle the CA and append `sslrootcert=/path/to/ca.pem` to `DATABASE_URL`. Staging / non-prod still skip validation. |

**Deploy checklist for PR 3:**
- [ ] Confirm `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are non-empty in prod & staging
- [ ] Set `TRUST_PROXY_HOPS` to match proxy depth (default `1` is correct for most deploys)
- [ ] If prod DB uses a self-signed TLS cert: update `DATABASE_URL` with `sslrootcert=...` before deploying, otherwise connections will fail
- [ ] Run `npx prisma migrate deploy` on staging to apply `add_subscription_billing_flag`
- [ ] Run same on production, then deploy the new application code
- [ ] Notify mobile/admin teams: handle new `403` from admin-created users, route to change-password screen

### Subtle behavior changes (visible to ops / support — flag to teams)

1. **Billing crons alert on Sentry when a subscription's `paystackAuthorizationCode` fails to decrypt.** `Sentry.captureMessage(level: warning)` + `billingFlaggedAt` timestamp is set on the subscription. Admin UI should grow a filter on `billingFlaggedAt IS NOT NULL` so ops can reach out to flagged members.
2. **Paystack webhook now retries on internal failures.** Previously, exceptions after the atomic claim were swallowed (200). Now they propagate as 500 and Paystack retries. Expect more webhook retry traffic when the DB/downstream flaps — this is correct, the retry hits the idempotent claim gate. Post-activation push/email failures remain best-effort (still swallowed, not retried).
3. **Running 2+ API replicas on the same billing schedule is now safe.** All five billing crons (card renewals, overdue expiry, mobile-money reminders, birthday wishes, auto-unfreeze) acquire a PostgreSQL advisory lock. Second replica hitting a held lock returns immediately. Not applied to other crons in this PR (see audit-tracker follow-ups).
4. **Login response time is now uniform.** Previously, requests for unknown emails returned fast (no bcrypt call); known emails ran bcrypt (~100ms). Now both paths run bcrypt (against a dummy hash on the miss path) so response time doesn't leak email existence. The `LOGIN_FAILED` audit log with `userId: null` still fires for unknown emails — no change there.
5. **Rate limiter now keys on real client IP, not proxy IP.** If your rate-limit dashboards suddenly show per-IP buckets instead of one hot bucket, that's the `trust proxy` fix working. Legitimate clients hit their throttle ceiling independently.
6. **Audit log metadata no longer contains raw passwords, tokens, or card references.** Sensitive keys (`password`, `token`, `cvv`, `paystackAuthorizationCode`, etc.) are replaced with `'[REDACTED]'` before persisting. Audit consumers reading these fields get a string literal, not the real value — adjust any downstream processors accordingly (unlikely any exist).
7. **Sentry events no longer tag errors with user email.** `Sentry.setUser` now sends `{ id, role }` only. If your Sentry alerting or audit workflows grouped on email, switch to `id`.

### Files changed (19 files + 1 migration, ~1,300 insertions)

**Code:**
- `src/auth/strategies/basic.strategy.ts` — H1, H2
- `src/auth/auth.service.ts` — M5, H5 (JWT payload)
- `src/auth/strategies/jwt.strategy.ts` — H5
- `src/auth/guards/jwt-auth.guard.ts` — H5 (enforcement)
- `src/auth/auth.controller.ts` — H5 (decorator application)
- `src/auth/decorators/allow-while-must-change-password.decorator.ts` — H5 (new)
- `src/audit-logs/audit.interceptor.ts` — H3
- `src/common/utils/redact-sensitive.ts` — H3 (new)
- `src/sentry/sentry-user.interceptor.ts` — H4
- `src/billing/billing.service.ts` — H8 alerting, M16 locks
- `src/common/config/app.config.ts` — M1 (trust proxy config)
- `src/main.ts` — M1 trust proxy, M2 Swagger gate
- `src/common/middleware/swagger-basic-auth.middleware.ts` — M2 (new)
- `src/prisma/prisma.service.ts` — M18
- `src/analytics/activity.gateway.ts` — M10
- `src/payments/payments.service.ts` — M13

**Schema:**
- `prisma/schema.prisma` — `MemberSubscription.billingFlaggedAt`

**Config:**
- `src/common/config/auth.config.ts` — H2 BASIC_AUTH boot enforcement

**Migrations:**
- `prisma/migrations/20260422130000_add_subscription_billing_flag/`

**Specs:** matching `.spec.ts` for every modified file; new specs for the new middleware, decorator, and utilities.

### Known follow-ups (not in this PR)

- **Other crons could benefit from M16's advisory-lock pattern**: payments cleanup (`payments.service.ts`), goals sweeper/weekly-pulse/weekly-digest (`goals/goals.cron.ts`), member-tags recompute, QR rotation, imports processor, licensing phone-home. Currently only billing is protected. Several others are already idempotent by design (e.g., subscription cleanup uses atomic `deleteMany` claims from H11).
- **`sslrootcert` wiring is ops' responsibility** — M18 enforces `rejectUnauthorized: true` in prod, but if prod DB uses a self-signed cert you must bundle the CA and update `DATABASE_URL` before the deploy, otherwise connections fail.

---
