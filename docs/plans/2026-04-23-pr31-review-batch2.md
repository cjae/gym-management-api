# PR #31 Review Findings — Batch 2 (post 63d8956)

Open findings from CodeRabbit reviews posted after the last push.

---

## 🟠 Major

| # | File | Lines | Finding |
|---|------|-------|---------|
| M1 | `src/billing/billing.service.ts` | 194–206 | Auto-unfreeze cron uses unconditional `update`; races a user-initiated unfreeze and double-increments `frozenDaysUsed`/`freezeCount`. Switch to `updateMany({ where: { id, status: 'FROZEN' } })`, skip on `count === 0`. |
| M2 | `src/billing/billing.service.ts` | 304 | When `ENCRYPTION_KEY` is unset, code throws and clears `paystackAuthorizationCode`. Should use it as plaintext instead; only throw/clear on actual decrypt failures. |
| M3 | `src/discount-codes/discount-codes.service.ts` | 425 | Duo member added after redemption bypasses per-member counter. `addDuoMember` must transactionally claim the new member's `DiscountRedemptionCounter` with the same guarded increment. |
| M4 | `src/trainers/trainers.controller.ts` | 71 | `GET /trainers/my/trainer` allows ADMIN/SUPER_ADMIN. Should be restricted to `MEMBER` only. |
| M5 | `src/trainers/trainers.controller.spec.ts` | 164 | Tests only check `@Roles()` metadata; don't assert `@UseGuards()` decorators are attached. Add `GUARDS_METADATA` assertions via `Reflector`. |
| M6 | `prisma/seed.ts` | 16 | `useSSL = dbUrl?.includes('sslmode=') \|\| isProduction` enables SSL for `sslmode=disable`. Parse the actual value; only set `useSSL` for `require`/`verify-ca`/`verify-full`. |

---

## 🟡 Minor

| # | File | Lines | Finding |
|---|------|-------|---------|
| m1 | `src/payments/payments.service.ts` | 417 | `autoRenew = true` set even when auth code can't be persisted (no `ENCRYPTION_KEY`). When skipping auth code storage, also set `updateData.autoRenew = false`. |
| m2 | `src/goals/goal-prompt.builder.ts` | 167 | Grammar: `"reads as a complement trainer guidance"` → `"reads as a complement to the trainer's guidance"`. |
| m3 | `src/goals/goal-prompt.builder.ts` | 92 | `weeksUntilDeadline` can be 0 or negative. Gate the parenthetical: `> 0` → `(~N weeks away)`, `=== 0` → `(due this week)`, `< 0` → `(deadline already passed)`. |
| m4 | `src/common/utils/redact-sensitive.ts` | 60 | Arrays bypass `WeakSet` cycle guard (only plain objects tracked). Also extend `REDACTED_KEYS` with `signature`, `sessionId`, `clientSecret`, `jwt`. |
| m5 | `src/discount-codes/discount-codes.service.spec.ts` | 552–564 | One-shot `mockResolvedValueOnce` consumed by first `validateCodeForProbe` call; second assertion tests stale state. Collapse into a single assertion or re-seed mocks. |
| m6 | `src/subscriptions/subscriptions.service.ts` | 408–464 | `addDuoMember` capacity check evaluated before the transaction; two concurrent adds can exceed `plan.maxMembers`. Move `count()` guard inside `$transaction`. |
| m7 | `src/auth/auth.service.ts` | 159–176 | Suspended/inactive accounts return `"Account is suspended"` while wrong password returns `"Invalid credentials"` — minor enumeration residue. Return uniform `"Invalid credentials"` for non-ACTIVE accounts. |
| m8 | `docs/plans/2026-04-22-security-remediation-client-impact.md` | 230 | Heading says "One new Prisma migration" but the list has two. Fix to "Two new Prisma migrations". |

---

## Status

| # | Status |
|---|--------|
| M1 | ✅ Fixed |
| M2 | ✅ False positive — already fixed in prior commits |
| M3 | ✅ Fixed |
| M4 | ✅ False positive — already fixed in 63d8956 |
| M5 | ⏸ Deferred — low-priority regression guardrail; existing role-behavior tests are thorough |
| M6 | ✅ Fixed |
| m1 | ✅ False positive — billing cron gates on non-null auth code, subscription never picked up |
| m2 | ✅ Fixed — grammar corrected in LLM prompt |
| m3 | ✅ False positive — Math.max(1, ...) clamp guarantees weeksUntilDeadline ≥ 1 |
| m4 | ⏸ Deferred — circular arrays unreachable via JSON/Prisma; extra keys worth adding in a hardening pass |
| m5 | ✅ False positive — validateCodeForProbe called once; both assertions target the same Promise |
| m6 | ⏸ Deferred — race requires simultaneous requests from same owner; near-zero real-world probability |
| m7 | ⏸ Deferred — real but negligible in gym context; requires knowing correct password first |
| m8 | ✅ Fixed — "One" → "Two" new Prisma migrations in deploy checklist |
