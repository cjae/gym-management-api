# Security Audit Remediation Tracker

**Audit date:** 2026-04-22
**Total findings:** 42 (4 Critical · 13 High · 18 Medium · 7 Low)
**Status legend:** `[ ]` pending · `[x]` done · `[~]` in progress · `[-]` wontfix (with note)

## Progress

| Severity | Total | Done | Wontfix | Pending |
|---|---|---|---|---|
| Critical | 4 | 4 | 0 | 0 |
| High | 13 | 12 | 1 | 0 |
| Medium | 18 | 9 | 0 | 9 |
| Low | 7 | 0 | 0 | 7 |
| **Total** | **42** | **25** | **1** | **16** |

Client/ops impact for shipped fixes: see `docs/plans/2026-04-22-security-remediation-client-impact.md`.

## How to use this doc

1. Pick the next unchecked item (top-down by severity).
2. Create a branch, fix, add/update tests, open PR.
3. When merged: flip `[ ]` → `[x]`, bump the Done count in the Progress table, add a one-line note with the PR link or commit sha.
4. If a finding is wontfix, mark `[-]` and write the justification inline.

---

## Critical (4) — ✅ DONE (PR 1, 2026-04-22)

- [x] **C1** — JWT secret falls back to `'dev-secret'` unless `NODE_ENV === 'production'` exact-match
  - File: `src/common/config/auth.config.ts`
  - Fix: `requireInSecureEnvs` allows fallback only for `NODE_ENV === 'development' | 'test'`; throws for every other env including unset
- [x] **C2** — Paystack webhook HMAC compared with `!==` (timing leak)
  - File: `src/payments/payments.service.ts:251-256`
  - Fix: buffer-length guard + `crypto.timingSafeEqual`; same `BadRequestException('Invalid signature')` message preserved
- [x] **C3** — Webhook idempotency is check-then-write race (parallel webhooks double-apply)
  - File: `src/payments/payments.service.ts:280-290`
  - Fix: atomic `payment.updateMany({ where: { id, status: 'PENDING' } })`; `count === 0` returns `{received: true}` without side effects
- [x] **C4** — `paystackAuthorizationCode` stored plaintext when `ENCRYPTION_KEY` unset
  - Files: `src/common/config/payment.config.ts`, `src/payments/payments.service.ts:375-386`, `src/billing/billing.service.ts:165-187`
  - Fix: config-load enforcement mirrors C1; write path never persists plaintext; billing read path nulls & logs on decrypt failure so legacy rows self-heal

## High (13)

- [x] **H1** — Basic Auth compares with `===` (timing side-channel)
  - File: `src/auth/strategies/basic.strategy.ts`
  - Fix: `crypto.timingSafeEqual` over SHA-256 digests of both sides (fixed-length buffers); both user+pass compared independently (no `&&` short-circuit)
- [x] **H2** — Basic Auth fails open when either env var set but other blank
  - File: `src/auth/strategies/basic.strategy.ts`, `src/common/config/auth.config.ts`
  - Fix: both `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` now routed through `requireInSecureEnvs` — throws at boot in non-dev/test envs when either is missing/empty
- [x] **H3** — Audit interceptor stores raw request body (passwords, tokens, card data)
  - File: `src/audit-logs/audit.interceptor.ts`, new `src/common/utils/redact-sensitive.ts`
  - Fix: `redactSensitive()` helper deep-walks request body replacing known sensitive keys (password, token, cvv, paystackAuthorizationCode, …) with `'[REDACTED]'` before persisting to audit metadata. Case-insensitive matching
- [x] **H4** — Sentry tags all errors with user email (PII leakage to 3rd party)
  - File: `src/sentry/sentry-user.interceptor.ts`
  - Fix: `Sentry.setUser` now receives only `{ id, role }` — email dropped
- [x] **H5** — `mustChangePassword` flag not enforced at guard level
  - Files: `src/auth/guards/jwt-auth.guard.ts`, new `src/auth/decorators/allow-while-must-change-password.decorator.ts`, `src/auth/auth.service.ts` (JWT payload), `src/auth/strategies/jwt.strategy.ts`
  - Fix: JWT now carries `mustChangePassword` claim; `JwtAuthGuard` enforces 403 on non-allowlisted routes. Allowlist (via `@AllowWhileMustChangePassword()`): `GET /auth/me`, `PATCH /auth/change-password`, `POST /auth/logout`. Chose to extend JwtAuthGuard rather than a global guard because `@UseGuards(JwtAuthGuard)` runs at route level (after globals) — in-guard enforcement guarantees ordering
- [x] **H6** — Password-reset token consumption is check-then-write race
  - File: `src/auth/auth.service.ts:285-321`
  - Fix: atomic `passwordResetToken.updateMany({ token, usedAt: null, expiresAt > now })` claim inside `$transaction`; password write gated on `count === 1`; same error message preserved
- [-] **H7** — Billing cron charges using stale plan price (price changes since sub creation)
  - Wontfix justification: Not a security bug — a product contract question. This is a single-tenant gym with direct member relationships; price changes are communicated out-of-band to members before taking effect. Snapshotting the price would require a "cancel and resubscribe" escape hatch we don't have and don't want (would need to handle pro-rata refunds, streak preservation, freeze carry-over, check-in history). The original behavior (bill from `SubscriptionPlan.price`) is intentional for this domain. Revisit if the product goes multi-tenant white-label.
- [x] **H8** — Billing cron silently skips on decrypt failure (no alerting)
  - Files: `prisma/schema.prisma`, `src/billing/billing.service.ts`
  - Fix: on decrypt failure the cron now fires `Sentry.captureMessage(..., { level: 'warning' })` with subscription + member IDs, and stamps new `MemberSubscription.billingFlaggedAt` column so admin UI can surface these. Migration `20260422130000_add_subscription_billing_flag` adds the nullable column
- [x] **H9** — Discount `maxUsesPerMember` count-then-check inside transaction but not atomic against concurrent redemption
  - Files: `src/discount-codes/discount-codes.service.ts`, new `DiscountRedemptionCounter` table
  - Fix: per-(code, member) counter row with conditional `updateMany({ uses < maxUsesPerMember })` increment — same atomic shape as `currentUses`. Migration `20260422120000_add_discount_redemption_counter` with backfill
- [x] **H10** — Per-member cap keyed on `memberId` only — duo subscriptions let secondary member reuse
  - File: `src/discount-codes/discount-codes.service.ts` (validate 261-272, redeem 364-406, reverse 452-475)
  - Fix: counter incremented for EVERY subscription member (primary + duo partners) so "benefited once" scoping is correct. Validate path uses same lookup
- [x] **H11** — PENDING subscription cleanup cron races in-flight webhook
  - File: `src/subscriptions/subscriptions.service.ts` (`cleanupPendingSubscriptions`)
  - Fix: per-id `deleteMany({ id, status: 'PENDING' })` atomic claim inside tx with `reverseRedemption` only on successful claim; webhook's atomic `payment.updateMany({status:'PENDING'})` from PR 1 safely loses races now
- [x] **H12** — Gym-class capacity check runs outside enrollment transaction
  - File: `src/gym-classes/gym-classes.service.ts`
  - Fix: added `enrolledCount` counter column; enroll uses `updateMany({ enrolledCount < maxCapacity })` inside tx, unenroll guards `enrolledCount > 0`. Migration `20260422000000_add_gym_class_enrolled_count` with backfill
- [x] **H13** — Referral reward uses non-atomic `updateMany` pattern (double reward on parallel webhooks)
  - File: `src/payments/payments.service.ts:597-690` (consolidated from `src/referrals/`)
  - Fix: `processReferralReward` now runs INSIDE the webhook's claim transaction; uses atomic `referral.updateMany({ status: 'PENDING' })` claim before extending subscription; out-of-tx side effects deferred to post-commit

## Medium (18)

- [x] **M1** — Throttler not proxy-aware; `app.set('trust proxy', ...)` missing in `main.ts`
  - Files: `src/main.ts`, `src/common/config/app.config.ts`
  - Fix: `TRUST_PROXY_HOPS` env-configurable field (default `1`) wired via `app.set('trust proxy', hops)`; throttler now keyed by real client IP
- [x] **M2** — Swagger UI publicly exposed at `/api/docs` (no auth gate)
  - Files: `src/main.ts`, new `src/common/middleware/swagger-basic-auth.middleware.ts`
  - Fix: outside `NODE_ENV=development|test`, `/api/docs` and `/api/docs-json` gated behind Basic Auth (reuses `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`, timing-safe compare). If creds are missing in prod-like envs, Swagger is disabled entirely rather than served open
- [ ] **M3** — JWT invalidation blocklist check has race with token issuance
- [ ] **M4** — No refresh-token-reuse detection (stolen refresh token reusable until expiry)
- [x] **M5** — Login response timing enumerates valid emails
  - File: `src/auth/auth.service.ts`
  - Fix: on user-not-found (or soft-deleted) path, now runs `bcrypt.compare` against a module-level dummy hash so both branches spend ~equal time. Error message + audit log unchanged
- [ ] **M6** — `POST /discount-codes/validate` leaks existence/state via distinct error messages
- [ ] **M7** — Trainer roster visible to MEMBER role (should be need-to-know)
- [ ] **M8** — Soft-delete leaves PII (email, phone, displayPicture) on User row indefinitely
- [ ] **M9** — Deletion approve/cancel endpoints race (member cancels while admin approves)
- [x] **M10** — WebSocket gateway CORS origin `*`
  - File: `src/analytics/activity.gateway.ts`
  - Fix: CORS origin now an explicit allowlist from `ADMIN_URL` (comma-separated, default `http://localhost:3001`) with `credentials: true`. Native mobile clients (no Origin header) unaffected
- [ ] **M11** — Goal title/description rendered by mobile — HTML/markdown injection possible
- [ ] **M12** — Admin-created user welcome email is phishing surface (temp password in plaintext)
- [x] **M13** — Webhook returns 200 on internal failure (Paystack stops retrying)
  - File: `src/payments/payments.service.ts`
  - Fix: post-claim work wrapped in try/catch that logs and rethrows — Paystack now sees 5xx and retries. Signature-invalid (400) and idempotent-no-op (200) paths unchanged
- [x] **M14** — Attendance streak update is non-atomic across multi-entrance check-ins
  - File: `src/attendance/attendance.service.ts`
  - Fix: `attendance.create` now inside `$transaction`, relies on `@@unique([memberId, checkInDate])` as atomic gate; `P2002` catch routes to no-op "already checked in today"; streak upsert guarded by `lastCheckInDate !== today`; activity/push/milestone events deferred to post-commit
- [x] **M15** — Goal generation state machine (`GENERATING` → `READY`/`FAILED`) transitions outside transaction
  - Files: `src/goals/listeners/goal-generation.listener.ts`, `src/goals/goals.cron.ts` (sweeper was already correct)
  - Fix: listener wraps plan items + milestones + transition in one `$transaction`; atomic `goal.updateMany({ generationStatus: 'GENERATING' })` state-guard; `GenerationRaceLostError` rolls back the tx if sweeper already claimed; READY push deferred to post-commit
- [x] **M16** — Billing cron not replica-safe (running two instances double-charges)
  - File: `src/billing/billing.service.ts`
  - Fix: all five billing crons wrapped in `pg_try_advisory_lock` — only one replica runs each cycle; lock released in a finally clause so crashes don't leave locks held
- [ ] **M17** — License grace period trusts local clock (7-day window manipulatable)
- [x] **M18** — Prisma SSL option `rejectUnauthorized: false` in prod config
  - Files: `src/prisma/prisma.service.ts`, `prisma/seed.ts`
  - Fix: `rejectUnauthorized` is now `true` in production (TLS cert validation enforced), `false` elsewhere for dev self-signed setups. Ops follow-up: if prod DB uses a self-signed cert, bundle the CA and append `sslrootcert=/path/to/ca.pem` to `DATABASE_URL`

## Low (7)

- [ ] **L1** — CSV export allows formula injection (`=cmd|...`)
- [ ] **L2** — Sourcemaps shipped to production
- [ ] **L3** — `/api/health` bypasses all guards (info disclosure)
- [ ] **L4** — Helmet default CSP is permissive
- [ ] **L5** — License phone-home payload includes member count / revenue (telemetry disclosure)
- [ ] **L6** — `DATABASE_URL` not validated at boot (late failure)
- [ ] **L7** — Freeze counter reset has no replay protection across billing cycles

---

## PR batching plan

- **PR 1 — Critical (C1–C4):** fail-closed secrets, timing-safe HMAC, atomic webhook idempotency, require `ENCRYPTION_KEY`. Small diff, no schema.
- **PR 2 — Races (H6, H9, H10, H11, H12, H13, M14, M15):** convert check-then-write to atomic SQL/transactions. Heaviest review — needs integration tests with concurrency.
- **PR 3 — Data exposure / hygiene (H1, H2, H3, H4, H5, H8, M1, M2, M5, M10, M13, M16, M18):** middleware, config, and logging. Mostly additive.
- **PR 4 — Remaining Medium + Low:** sprint-cadence cleanup.

## Attack chains (from audit — for regression-test coverage)

- **A — Payments fraud:** C2/C3 → parallel webhook → H13 double-reward → H10 duo-discount → H9 cap bypass
- **B — Admin takeover:** C1 forge SUPER_ADMIN → COMPLIMENTARY subs → H3 mine audit logs → C4 replay cards
- **C — PII harvest:** M2 Swagger map → M5 enumerate emails → M1 defeat rate limit → H3 audit mining → H4 Sentry
- **D — Subscription rescue abuse:** PENDING → H11 race cleanup → H3 audit body leak via support

## Changelog

<!-- Append one line per merged fix: `YYYY-MM-DD — [ID] short description — <PR/commit>` -->
- 2026-04-22 — C1 JWT/refresh secrets fail-closed outside dev/test — 26c61b0 (PR 1)
- 2026-04-22 — C2 timing-safe HMAC compare on Paystack webhook — 26c61b0 (PR 1)
- 2026-04-22 — C3 atomic webhook idempotency via `updateMany` claim — 26c61b0 (PR 1)
- 2026-04-22 — C4 require `ENCRYPTION_KEY`, self-heal legacy plaintext auth codes — 26c61b0 (PR 1)
- 2026-04-22 — H6 atomic password-reset token claim — (uncommitted, PR 2)
- 2026-04-22 — H9 per-member discount cap via counter table — (uncommitted, PR 2, **migration**)
- 2026-04-22 — H10 duo-subscription discount bypass fixed via counter scope — (uncommitted, PR 2)
- 2026-04-22 — H11 atomic PENDING-subscription cleanup cron — (uncommitted, PR 2)
- 2026-04-22 — H12 gym-class enrollment capacity via counter column — (uncommitted, PR 2, **migration**)
- 2026-04-22 — H13 referral reward moved into webhook tx with atomic claim — (uncommitted, PR 2)
- 2026-04-22 — M14 atomic attendance check-in + streak + deferred events — 73243d5 (PR 2)
- 2026-04-22 — M15 atomic goal generation state machine in listener — 73243d5 (PR 2)
- 2026-04-22 — H1 Basic Auth timing-safe compare — (uncommitted, PR 3)
- 2026-04-22 — H2 Basic Auth fail-closed + boot-time enforcement — (uncommitted, PR 3)
- 2026-04-22 — H3 audit interceptor deep-redacts sensitive body keys — (uncommitted, PR 3)
- 2026-04-22 — H4 Sentry user context drops email, keeps id+role — (uncommitted, PR 3)
- 2026-04-22 — H5 mustChangePassword enforced via JwtAuthGuard with decorator opt-out — (uncommitted, PR 3)
- 2026-04-22 — H7 wontfix — product contract question, not a security bug; original behavior (bill from `SubscriptionPlan.price`) is intentional for this single-tenant domain
- 2026-04-22 — H8 billing decrypt failure now alerts on Sentry + flags subscription — (uncommitted, PR 3, **migration**)
- 2026-04-22 — M1 trust proxy hops + throttler keyed on real client IP — (uncommitted, PR 3)
- 2026-04-22 — M2 Swagger UI gated behind Basic Auth outside dev/test — (uncommitted, PR 3)
- 2026-04-22 — M5 login timing parity via dummy bcrypt compare on miss — (uncommitted, PR 3)
- 2026-04-22 — M10 WebSocket CORS narrowed to ADMIN_URL allowlist — (uncommitted, PR 3)
- 2026-04-22 — M13 webhook propagates 5xx on post-claim failures (Paystack retries) — (uncommitted, PR 3)
- 2026-04-22 — M16 billing crons wrapped in pg advisory lock (replica-safe) — (uncommitted, PR 3)
- 2026-04-22 — M18 Prisma SSL cert validation enforced in production — (uncommitted, PR 3)
