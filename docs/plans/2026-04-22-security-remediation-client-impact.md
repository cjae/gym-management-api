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
