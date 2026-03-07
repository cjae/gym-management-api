# Gym Management Platform — Handover Document

## What's Done

The **gym-management API** (NestJS 11 + Prisma + PostgreSQL) is fully built, tested, and security-hardened. 14 commits, 61 passing tests, 11 modules.

### Project Location
- API: `/Users/osagieomonzokpia/Documents/js/gym-management`
- Branch: `main`
- Latest commit: `57fc005`

### Tech Stack
- NestJS 11, Prisma 6, PostgreSQL, JWT auth, Paystack payments
- All endpoints prefixed with `/api`
- CORS configured for `http://localhost:3001` (admin dashboard)
- ValidationPipe with whitelist + transform enabled

### API Modules & Endpoints

**Auth** (`/api/auth`) — Public
- `POST /register` — email, password (min 8), firstName, lastName, phone?
- `POST /login` — email, password → returns { accessToken, refreshToken }

**Users** (`/api/users`) — Admin/SuperAdmin only
- `GET /` — list all users (no password field)
- `GET /:id` — single user
- `PATCH /:id` — update firstName, lastName, phone, status (role removed for security)
- `DELETE /:id` — remove user

**Subscription Plans** (`/api/subscription-plans`)
- `GET /` — active plans only (authenticated)
- `GET /all` — all plans including inactive (Admin+)
- `GET /:id` — single plan (authenticated)
- `POST /` — create plan: name, price, durationDays, description?, maxMembers? (Admin+)
- `PATCH /:id` — update plan (Admin+)
- `DELETE /:id` — remove plan (Admin+)

**Subscriptions** (`/api/subscriptions`)
- `POST /` — create subscription: { planId } (authenticated, uses current user)
- `POST /:id/duo` — add duo member: { memberEmail } (subscription owner only)
- `GET /my` — current user's subscriptions (authenticated)
- `GET /` — all subscriptions (Admin+)
- `PATCH /:id/cancel` — cancel subscription (owner only)

**Payments** (`/api/payments`)
- `POST /initialize/:subscriptionId` — initialize Paystack payment (authenticated)
- `POST /webhook` — Paystack webhook handler (no auth, HMAC verified)
- `GET /history` — payment history (authenticated)

**Attendance** (`/api/attendance`)
- `POST /check-in` — QR-based check-in: { qrCode } (authenticated)
  - Validates QR code is active
  - Checks member has active subscription (direct or via duo)
  - Idempotent per day (first scan = check-in, subsequent = "already checked in")
  - Updates streak automatically
- `GET /history` — last 90 days attendance (authenticated)
- `GET /streak` — current/longest streak (authenticated)
- `GET /leaderboard` — top 50 streaks with member names (authenticated)
- `GET /today` — today's check-ins (Admin+)

**QR** (`/api/qr`) — Admin/SuperAdmin only
- `POST /generate` — generate new QR code (deactivates previous)
- `GET /active` — get current active QR code

**Trainers** (`/api/trainers`)
- `GET /` — all trainers with profiles and schedules (authenticated)
- `GET /:id` — single trainer with assignments (authenticated)
- `POST /` — create trainer profile: { userId, specialization?, bio?, availability? } (Admin+)
- `POST /:id/schedules` — add schedule: { title, dayOfWeek, startTime, endTime, maxCapacity? } (Admin+)
- `GET /:id/schedules` — trainer's schedules (authenticated)
- `POST /assign` — assign member: { trainerId, memberId, startDate, endDate?, notes? } (Admin+)
- `GET /my/trainer` — current user's assigned trainer (authenticated)

**Legal** (`/api/legal`)
- `GET /` — all legal documents (authenticated)
- `GET /unsigned` — required docs not yet signed by current user (authenticated)
- `POST /` — create document: { title, content, isRequired? } (Admin+)
- `POST /sign` — sign document: { documentId, signatureData (base64) } (authenticated)
- `GET /:id/signatures` — signing status for a document (Admin+)

**Salary** (`/api/salary`) — SuperAdmin ONLY
- `POST /` — create: { staffId, month, year, amount, notes? }
- `GET /` — list all (optional ?month=&year= filters)
- `GET /staff/:staffId` — records for specific staff
- `PATCH /:id/pay` — mark as paid
- `DELETE /:id` — remove record

### Database Schema (Prisma)

14 models: User, SubscriptionPlan, MemberSubscription, SubscriptionMember, Attendance, Streak, TrainerProfile, TrainerSchedule, TrainerAssignment, LegalDocument, DocumentSignature, StaffSalaryRecord, GymQrCode

Key enums: Role (SUPER_ADMIN, ADMIN, TRAINER, MEMBER), UserStatus, SubscriptionStatus, PaymentStatus, SalaryStatus

### Auth System
- JWT tokens: access (15m), refresh (7d)
- Token payload: { sub: userId, email, role }
- Guards: JwtAuthGuard (passport-jwt), RolesGuard (checks @Roles decorator)
- Decorators: @Roles('ADMIN', 'SUPER_ADMIN'), @CurrentUser('id'), @CurrentUser('email')

### Seed Data (prisma/seed.ts)
Default password for all seed users: `password123`
- Super Admin: admin@gym.co.ke
- Admins: frontdesk1@gym.co.ke, frontdesk2@gym.co.ke
- Trainers: trainer1/2/3@gym.co.ke (with profiles)
- Members: member1-10@example.com
- Plans: Monthly Solo (KES 3000), Monthly Duo (KES 5000), Annual Solo (KES 30000)
- Sample subscriptions, attendance records, streaks, legal doc, QR code

### .env Variables
```
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
PAYSTACK_SECRET_KEY=...          # REQUIRED — app will not start without it
PORT=3000
ADMIN_URL=http://localhost:3001
BASIC_AUTH_USER=...
BASIC_AUTH_PASSWORD=...
MAILGUN_API_KEY=...              # optional — logs emails to console when unset
MAILGUN_DOMAIN=...
SENTRY_DSN=...                   # optional in dev
```

### Security Hardening (Applied)

A full security audit was conducted. The following **critical** and **high** findings have been fixed:

**Critical fixes:**
1. Webhook signature verification now uses raw request body (not re-serialized JSON)
2. Webhook replay protection via idempotency check on `paystackReference` (`@unique`)
3. Role escalation removed — `role` field stripped from `UpdateUserDto`
4. `paystackAuthorizationCode` stripped from all subscription API responses
5. Password hashes no longer leak through trainer endpoints (`safeUserSelect`)
6. IDOR fixed — payment initialization validates subscription ownership
7. `PAYSTACK_SECRET_KEY` now required at startup (no empty string fallback)

**High fixes:**
8. Rate limiting via `@nestjs/throttler` — global 30/min, auth endpoints 3-10/min
9. Security headers via `helmet` (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
10. JWT algorithm pinned to `HS256` to prevent algorithm confusion attacks
11. `@MaxLength` added to all unbounded string fields across DTOs
12. Error logging in `chargeAuthorization` catch block (was silently swallowed)

---

## What's Remaining

### Security — Remaining Items

**High priority (should fix before production):**
- Hash password reset tokens in database (currently stored plaintext)
- Use separate JWT secret for refresh tokens (`JWT_REFRESH_SECRET` is defined but unused)
- Encrypt `paystackAuthorizationCode` at rest (currently plaintext in DB)
- Add request body size limits in `main.ts`
- Add pagination to `findAll` endpoints (users, trainers, legal, plans)

**Medium priority:**
- Invalidate all sessions on password change (currently tokens remain valid until expiry)
- Protect Swagger docs in production (currently accessible without auth at `/api/docs`)
- Add CSRF protection for state-changing endpoints
- Add cleanup cron for expired `InvalidatedToken` and `PasswordResetToken` records
- Billing charges `plan.price` — should store agreed price on subscription to prevent mid-cycle price changes

**Low priority:**
- Strengthen password requirements (currently only `MinLength(8)`, no complexity rules)
- Normalize email addresses (case-insensitive comparison)
- Reduce Sentry sample rates for production
- Add audit logging for sensitive operations
- Mask reset tokens in dev console logs

### Phase 4: Admin Dashboard (separate project)
Create `gym-admin` at `~/Documents/js/gym-admin` using Next.js + Tailwind.

**Pages to build:**
1. Login page (`/login`)
2. Dashboard (`/`) — stats: active members, revenue, today's attendance
3. Members (`/members`) — table with search, edit, status toggle
4. Subscriptions (`/subscriptions`) — plans CRUD + active subscriptions + duo linkages
5. Attendance (`/attendance`) — today's check-ins, search by member
6. Trainers (`/trainers`) — roster, schedules, member assignments
7. Legal Docs (`/legal`) — document management, signing status
8. QR Code (`/qr`) — generate/view entrance QR code
9. Staff & Payroll (`/payroll`) — salary records (SuperAdmin only, hidden for Admin)
10. Settings (`/settings`) — SuperAdmin only

**Key components:**
- API client (axios, baseURL `http://localhost:3000/api`, JWT interceptor, localStorage tokens)
- Auth context (login/logout, JWT decode for role, redirect to /login on 401)
- Sidebar (role-filtered nav items, payroll hidden for non-SuperAdmin)
- Layout (sidebar + main content area)

### Phase 5: Mobile App (separate project)
Create `gym-mobile` at `~/Documents/js/gym-mobile` using Expo (blank-typescript template).

**Screens to build:**
1. Login / Register
2. Legal Docs (view required docs, draw signature with react-native-signature-canvas, submit base64)
3. Home (subscription status, streak count, quick check-in button)
4. QR Scanner (expo-camera barcode scan, POST /api/attendance/check-in, success/error display)
5. Subscription (view plans, subscribe, Paystack payment via react-native-paystack-webview, manage duo member)
6. Attendance History (calendar view of check-ins)
7. Leaderboard (ranked list, highlight current user)
8. Trainer (assigned trainer profile + schedule)
9. Profile (edit info, change password)

**Key libs:** expo-camera, expo-secure-store, react-native-signature-canvas, react-native-paystack-webview, @react-navigation/native + native-stack, axios

**Auth:** SecureStore for tokens, auth context similar to admin but with SecureStore instead of localStorage

**Flow:** Login → sign legal docs (blocked until done) → Home → scan QR / manage subscription / view leaderboard

### Phase 6: Final Testing
Smoke test all three apps together end-to-end.

---

## Design Docs
- Full design: `docs/plans/2026-03-07-gym-management-mvp-design.md`
- Implementation plan: `docs/plans/2026-03-07-gym-management-mvp-implementation.md`
