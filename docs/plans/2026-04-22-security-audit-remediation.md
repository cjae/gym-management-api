# Security Audit Remediation Tracker

**Audit date:** 2026-04-22
**Total findings:** 42 (4 Critical · 13 High · 18 Medium · 7 Low)
**Status legend:** `[ ]` pending · `[x]` done · `[~]` in progress · `[-]` wontfix (with note)

## Progress

| Severity | Total | Done | Pending |
|---|---|---|---|
| Critical | 4 | 4 | 0 |
| High | 13 | 0 | 13 |
| Medium | 18 | 0 | 18 |
| Low | 7 | 0 | 7 |
| **Total** | **42** | **4** | **38** |

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

- [ ] **H1** — Basic Auth compares with `===` (timing side-channel)
  - File: `src/auth/strategies/basic.strategy.ts:24`
- [ ] **H2** — Basic Auth fails open when either env var set but other blank
  - File: `src/auth/strategies/basic.strategy.ts:20` — condition uses `||` but should be `&&` fail-closed at boot
- [ ] **H3** — Audit interceptor stores raw request body (passwords, tokens, card data)
  - File: `src/audit-logs/audit.interceptor.ts:126-132`
  - Fix: deep-redact known sensitive keys before persisting metadata
- [ ] **H4** — Sentry tags all errors with user email (PII leakage to 3rd party)
  - File: `src/sentry/sentry-user.interceptor.ts:29`
  - Fix: send only `id` + `role`; drop email
- [ ] **H5** — `mustChangePassword` flag not enforced at guard level
  - Fix: global guard that 403s on non-password-change routes while flag is true
- [ ] **H6** — Password-reset token consumption is check-then-write race
  - File: `src/auth/auth.service.ts` (reset handler)
  - Fix: `updateMany` by token-hash + `usedAt IS NULL`, branch on count
- [ ] **H7** — Billing cron charges using stale plan price (price changes since sub creation)
  - File: `src/billing/billing.service.ts`
- [ ] **H8** — Billing cron silently skips on decrypt failure (no alerting)
  - Fix: log + Sentry breadcrumb, mark sub for manual review
- [ ] **H9** — Discount `maxUsesPerMember` count-then-check inside transaction but not atomic against concurrent redemption
  - File: `src/discount-codes/discount-codes.service.ts:335-344`
  - Fix: add unique constraint `(discountCodeId, memberId, subscriptionId)` + per-member cap via conditional insert
- [ ] **H10** — Per-member cap keyed on `memberId` only — duo subscriptions let secondary member reuse
  - Fix: also scope by primary member / household
- [ ] **H11** — PENDING subscription cleanup cron races in-flight webhook
  - Fix: cleanup job must re-check payment status immediately before delete inside tx
- [ ] **H12** — Gym-class capacity check runs outside enrollment transaction
  - File: `src/gym-classes/gym-classes.service.ts`
- [ ] **H13** — Referral reward uses non-atomic `updateMany` pattern (double reward on parallel webhooks)
  - File: `src/referrals/referrals.service.ts`

## Medium (18)

- [ ] **M1** — Throttler not proxy-aware; `app.set('trust proxy', ...)` missing in `main.ts`
- [ ] **M2** — Swagger UI publicly exposed at `/api/docs` (no auth gate)
  - File: `src/main.ts:101`
  - Fix: gate behind Basic Auth or disable in production
- [ ] **M3** — JWT invalidation blocklist check has race with token issuance
- [ ] **M4** — No refresh-token-reuse detection (stolen refresh token reusable until expiry)
- [ ] **M5** — Login response timing enumerates valid emails
  - Fix: constant-time compare path; same response time on hit/miss
- [ ] **M6** — `POST /discount-codes/validate` leaks existence/state via distinct error messages
- [ ] **M7** — Trainer roster visible to MEMBER role (should be need-to-know)
- [ ] **M8** — Soft-delete leaves PII (email, phone, displayPicture) on User row indefinitely
- [ ] **M9** — Deletion approve/cancel endpoints race (member cancels while admin approves)
- [ ] **M10** — WebSocket gateway CORS origin `*`
- [ ] **M11** — Goal title/description rendered by mobile — HTML/markdown injection possible
- [ ] **M12** — Admin-created user welcome email is phishing surface (temp password in plaintext)
- [ ] **M13** — Webhook returns 200 on internal failure (Paystack stops retrying)
- [ ] **M14** — Attendance streak update is non-atomic across multi-entrance check-ins
- [ ] **M15** — Goal generation state machine (`GENERATING` → `READY`/`FAILED`) transitions outside transaction
- [ ] **M16** — Billing cron not replica-safe (running two instances double-charges)
- [ ] **M17** — License grace period trusts local clock (7-day window manipulatable)
- [ ] **M18** — Prisma SSL option `rejectUnauthorized: false` in prod config

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
- 2026-04-22 — C1 JWT/refresh secrets fail-closed outside dev/test — (uncommitted, PR 1)
- 2026-04-22 — C2 timing-safe HMAC compare on Paystack webhook — (uncommitted, PR 1)
- 2026-04-22 — C3 atomic webhook idempotency via `updateMany` claim — (uncommitted, PR 1)
- 2026-04-22 — C4 require `ENCRYPTION_KEY`, self-heal legacy plaintext auth codes — (uncommitted, PR 1)
