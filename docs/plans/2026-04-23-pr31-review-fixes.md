# PR #31 — CodeRabbit Review Fixes

Source: https://github.com/cjae/gym-management-api/pull/31

---

## 🔴 Critical

| # | File | Line | Issue | Status |
|---|------|------|-------|--------|
| C1 | `src/payments/payments.service.ts` | 274–335 | Claim payment and activation must be in one transaction — crash between writes leaves subscription paid-but-unactivated permanently | [x] fixed |
| C2 | `src/payments/payments.service.ts` | 300 | Same atomicity issue — inline version | [x] fixed (same change as C1) |
| C3 | `src/billing/billing.service.ts` | 139 | Advisory lock must share the same DB connection as the billing transaction | [~] deferred — documented in JSDoc; proper fix requires all billing methods to accept a tx client, incompatible with in-flight HTTP calls |
| C4 | `src/trainers/trainers.controller.spec.ts` | 140 | CI failure: `'result' is possibly 'null'` blocks `tsc --noEmit` | [x] already fixed (commit c39cac2) |

---

## 🟠 Major

| # | File | Line | Issue | Status |
|---|------|------|-------|--------|
| M1 | `src/payments/payments.service.ts` | 120–176 | Pending-payment replacement is racy — `findFirst → update → create` can produce duplicate `PENDING` rows | [x] already fixed — `updateMany` in place |
| M2 | `src/payments/payments.service.ts` | 678–688 | Referral-cap race — concurrent first payments can both pass `completedInCycle < maxPerCycle` | [~] deferred — `KNOWN RACE` comment added; near-zero probability in practice |
| M3 | `src/auth/auth.controller.ts` | 159 | Add `@NoAudit()` to onboarding mutation | [x] false positive — audit interceptor gates on ADMIN/SUPER_ADMIN; MEMBER actions are never logged |
| M4 | `src/auth/auth.service.ts` | 442 | Early-exit on invalid reset token before bcrypt | [x] fixed — fail-fast `findFirst` check before `bcrypt.hash` |
| M5 | `src/auth/auth.service.ts` | 712 | JWT algorithm and secret not pinned on `signAsync` | [x] fixed — `algorithm: 'HS256'` and explicit secret on both access and refresh calls |
| M6 | `src/auth/dto/update-profile.dto.spec.ts` | 83 | Onboarding fields don't belong on `PATCH /auth/me` | [x] false positive — `PATCH /auth/me` is intentionally the post-onboarding update path |
| M7 | `src/common/constants/safe-user-select.ts` | 20 | Personalization fields exposed by broad user list endpoints | [x] fixed — split into `safeUserSelect` (base) + `safeUserPersonalizationSelect`; list endpoint no longer bulk-exposes health data |
| M8 | `src/billing/billing.service.ts` | 289 | Missing `ENCRYPTION_KEY` incorrectly clears saved Paystack auth codes | [x] fixed — missing key now skips with a warning; only actual decrypt failures clear the code |
| M9 | `src/discount-codes/discount-codes.service.ts` | 425 | Discount benefits not credited when duo members are added after redemption | [x] fixed — `addDuoMember` atomically upserts `DiscountRedemptionCounter`; 2 new tests |
| M10 | `src/goals/goals.service.ts` | 64 | Goal creation not gated on active subscription | [x] fixed — `hasActiveSubscription` check added after onboarding check; returns 400 when no active sub |
| M11 | `src/subscriptions/subscriptions.service.ts` | 777 | Freeze/unfreeze writes not guarded by expected current status | [x] fixed — `update` replaced with status-guarded `updateMany` + `findUniqueOrThrow`; `count=0` throws `ConflictException`; 4 tests updated |
| M12 | `src/trainers/trainers.controller.ts` | 66 | `GET /my/trainer` accessible to all roles | [x] fixed — `@Roles('MEMBER')` added; test updated |
| M13 | `src/users/dto/user-response.dto.ts` | 155 | Personalization fields exposed by broad user endpoints | [x] resolved by M7 |
| M14 | `prisma/seed.ts` | 16 | Seed script can run in production | [x] fixed — throws if `NODE_ENV=production` |

---

## 🟡 Minor

| # | File | Line | Issue | Status |
|---|------|------|-------|--------|
| L1 | `prisma/schema.prisma` | 196 | `preferredTrainingDays` uses `String[]` instead of `DayOfWeek` enum | [~] deferred — breaking schema + DTO + client change; enum uses `MONDAY`, DTOs/seed use `MON` short codes |
| L2 | `prisma/seed.ts` | 66 | `preferredTrainingDays` values don't match `DayOfWeek` enum | [~] deferred — same migration as L1 |
| L3 | `prisma/seed.ts` | 71 | Minor issue (no PR comment detail) | [~] deferred — same block as L1/L2 |
| L4 | `src/analytics/activity.gateway.ts` | 48 | Empty `ADMIN_URL` collapses WebSocket CORS allowlist | [x] fixed — `??` → `\|\|` so empty string falls back to default |
| L5 | `src/attendance/attendance.service.spec.ts` | outside diff | Missing test coverage | [~] deferred — `getHistory`, `getLeaderboard`, `getTodayAttendance` untested; unclear which was flagged |
| L6 | `src/common/utils/redact-sensitive.ts` | 60 | No cycle guard — circular refs cause infinite recursion | [x] fixed — `WeakSet` passed through recursion; circular nodes replaced with `'[Circular]'` |
| L7 | `src/discount-codes/discount-codes.service.spec.ts` | 564 | One-shot mocks consumed by two separate probe calls | [x] fixed — promise captured once, both assertions run against the same rejection |
| L8 | `src/discount-codes/discount-codes.service.spec.ts` | 782 | Minor issue (no PR comment detail) | [~] deferred — test looks correct; cannot identify specific issue |
| L9 | `src/goals/goal-prompt.builder.ts` | 68 | `subscriptionPlanName` injected into LLM prompt unsanitized | [x] fixed — `sanitizeText()` applied, consistent with `title` and `injuryNotes` |
| L10 | `src/payments/payments.service.ts` | 256 | Minor issue (no PR comment detail) | [~] deferred — code looks correct; cannot identify specific issue |
| L11 | `src/sentry/sentry-user.interceptor.spec.ts` | 41 | Test fixture doesn't match real JWT user shape | [x] fixed — real bug: interceptor used `user.sub` (undefined in prod); corrected to `user.id`; interface and fixture updated |
| L12 | `docs/plans/2026-04-21-goals-personalization.md` | 90, 121, 133, 158, 172, 194, 228, 268, 290, 307, 388, 411, 424 | Fenced code blocks missing language tags | [x] fixed — 12 blocks tagged `text`, 1 yarn command tagged `bash` |
| L13 | `docs/plans/2026-04-22-security-remediation-client-impact.md` | 130 | Fenced code block missing language tag | [x] already clean |
| L14 | `docs/plans/2026-04-22-security-remediation-client-impact.md` | 217 | Deletion-scrub docs don't match tested contract | [x] fixed — doc now reflects sentinels (`firstName='Deleted'`, `lastName='User'`), nulled fields, and `PushToken` deletion |
| L15 | `docs/plans/2026-04-22-security-remediation-client-impact.md` | 234 | Unescaped pipe inside table cell | [x] fixed |
