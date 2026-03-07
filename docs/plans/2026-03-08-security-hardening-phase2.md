# Security Hardening Phase 2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 5 high-priority security items remaining from the security audit.

**Architecture:** Each fix is independent — hash reset tokens (SHA-256), separate JWT refresh secret, encrypt Paystack auth codes (AES-256-GCM), add body size limits, add pagination to list endpoints. No schema migration needed for items 1-2. Item 3 requires a new `ENCRYPTION_KEY` env var. Items 4-5 are pure code changes.

**Tech Stack:** Node.js `crypto` module, NestJS `ValidationPipe`, `class-validator`, Prisma

---

### Task 1: Hash Password Reset Tokens

**Files:**
- Modify: `src/auth/auth.service.ts:66-127`
- Modify: `src/auth/auth.service.spec.ts:123-219`

**Step 1: Update `forgotPassword` to hash the token before storing**

In `src/auth/auth.service.ts`, add a `hashToken` helper and update `forgotPassword`:

```typescript
import { randomBytes, randomUUID, createHash } from 'crypto';

// Add as private method on AuthService:
private hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

In `forgotPassword`, hash before storing:
```typescript
const token = randomBytes(32).toString('hex');
const hashedToken = this.hashToken(token);
// ...
await this.prisma.passwordResetToken.create({
  data: {
    userId: user.id,
    token: hashedToken,  // store hash, not plaintext
    expiresAt,
  },
});
// Send the raw token to the user via email (not the hash)
await this.emailService.sendPasswordResetEmail(user.email, user.firstName, token);
```

**Step 2: Update `resetPassword` to hash the incoming token before lookup**

Change `findUnique` to `findFirst` since we now look up by hash:
```typescript
async resetPassword(dto: ResetPasswordDto) {
  const hashedToken = this.hashToken(dto.token);
  const resetToken = await this.prisma.passwordResetToken.findUnique({
    where: { token: hashedToken },
  });
  // ... rest stays the same
}
```

**Step 3: Update tests**

The `forgotPassword` test should verify the stored token is a SHA-256 hash (64 hex chars), not the raw token. The `resetPassword` tests need the mock to return a result when queried with the hashed version of the token.

Update the `forgotPassword` test:
```typescript
it('should create a reset token and send email for existing user', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: '1',
    email: 'test@test.com',
    firstName: 'Test',
  });
  mockPrisma.passwordResetToken.create.mockResolvedValue({});

  const result = await service.forgotPassword({ email: 'test@test.com' });

  expect(result.message).toContain('reset link has been sent');
  expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      userId: '1',
      token: expect.stringMatching(/^[a-f0-9]{64}$/), // SHA-256 hash
      expiresAt: expect.any(Date),
    }),
  });
  // Raw token (not hash) sent via email
  expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
    'test@test.com',
    'Test',
    expect.stringMatching(/^[a-f0-9]{64}$/), // raw token is also 64 hex chars (32 bytes)
  );
});
```

For `resetPassword` tests, the mock `findUnique` is called with the hashed version. Since we can't predict the hash of 'valid-token', we need to adjust: mock `findUnique` to accept any call and return the fixture. The existing test structure works because `findUnique` is already mocked to return a value regardless of input.

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern=auth`
Expected: All auth tests pass

**Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "fix(security): hash password reset tokens with SHA-256 before storing"
```

---

### Task 2: Separate JWT Secret for Refresh Tokens

**Files:**
- Modify: `src/auth/auth.service.ts:163-177`
- Modify: `src/auth/auth.module.ts`
- Modify: `src/auth/strategies/jwt.strategy.ts` (no change needed — access tokens still use jwtSecret)
- Modify: `src/auth/auth.service.spec.ts`

**Step 1: Inject ConfigService into AuthService**

Add `ConfigService` to the constructor and read `jwtRefreshSecret`:

```typescript
import { ConfigService } from '@nestjs/config';
import { AuthConfig, getAuthConfigName } from '../common/config/auth.config';

constructor(
  private prisma: PrismaService,
  private jwtService: JwtService,
  private emailService: EmailService,
  private configService: ConfigService,
) {}
```

**Step 2: Use separate secret for refresh token signing**

In `generateTokens`, pass the refresh secret explicitly:

```typescript
private async generateTokens(userId: string, email: string, role: string) {
  const authConfig = this.configService.get<AuthConfig>(getAuthConfigName())!;
  const accessJti = randomUUID();
  const refreshJti = randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    this.jwtService.signAsync(
      { sub: userId, email, role, jti: accessJti },
      { expiresIn: '15m' },
    ),
    this.jwtService.signAsync(
      { sub: userId, email, role, jti: refreshJti },
      { expiresIn: '7d', secret: authConfig.jwtRefreshSecret },
    ),
  ]);
  return { accessToken, refreshToken };
}
```

**Step 3: Add ConfigModule import to AuthModule**

In `src/auth/auth.module.ts`, add `ConfigModule` to imports (it's already globally available via `ConfigLoaderModule`, but we need `ConfigService` injectable in `AuthService`). Since `ConfigModule` is already imported for `JwtModule.registerAsync`, `ConfigService` should already be available. No module change needed — just the constructor injection.

**Step 4: Update auth tests to provide ConfigService mock**

Add to the test setup:
```typescript
const mockConfigService = {
  get: jest.fn().mockReturnValue({
    jwtSecret: 'test-secret',
    jwtRefreshSecret: 'test-refresh-secret',
    basicAuthUser: '',
    basicAuthPassword: '',
  }),
};

// In providers:
{ provide: ConfigService, useValue: mockConfigService },
```

Import `ConfigService` from `@nestjs/config` in the test file.

**Step 5: Run tests**

Run: `yarn test -- --testPathPattern=auth`
Expected: All auth tests pass

**Step 6: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "fix(security): use separate JWT secret for refresh tokens"
```

---

### Task 3: Encrypt Paystack Authorization Codes at Rest

**Files:**
- Create: `src/common/utils/encryption.util.ts`
- Create: `src/common/utils/encryption.util.spec.ts`
- Modify: `src/common/config/payment.config.ts`
- Modify: `src/payments/payments.service.ts:130-134`
- Modify: `src/billing/billing.service.ts:90-95`
- Modify: `src/billing/billing.service.spec.ts`

**Step 1: Create encryption utility**

Create `src/common/utils/encryption.util.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:ciphertext:tag (all hex)
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

export function decrypt(ciphertext: string, keyHex: string): string {
  const [ivHex, encryptedHex, tagHex] = ciphertext.split(':');
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

**Step 2: Write encryption utility tests**

Create `src/common/utils/encryption.util.spec.ts`:

```typescript
import { encrypt, decrypt } from './encryption.util';
import { randomBytes } from 'crypto';

describe('encryption util', () => {
  const key = randomBytes(32).toString('hex');

  it('should encrypt and decrypt a string', () => {
    const plaintext = 'AUTH_abc123xyz';
    const encrypted = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  it('should produce different ciphertexts for same input (random IV)', () => {
    const plaintext = 'AUTH_abc123xyz';
    const e1 = encrypt(plaintext, key);
    const e2 = encrypt(plaintext, key);
    expect(e1).not.toBe(e2);
  });

  it('should fail with wrong key', () => {
    const plaintext = 'AUTH_abc123xyz';
    const encrypted = encrypt(plaintext, key);
    const wrongKey = randomBytes(32).toString('hex');
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});
```

**Step 3: Run encryption tests**

Run: `yarn test -- --testPathPattern=encryption`
Expected: All 3 tests pass

**Step 4: Add `encryptionKey` to payment config**

In `src/common/config/payment.config.ts`:

```typescript
export type PaymentConfig = {
  paystackSecretKey: string;
  encryptionKey: string;
};

export const getPaymentConfig = (): PaymentConfig => {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    throw new Error('PAYSTACK_SECRET_KEY environment variable is required');
  }
  return {
    paystackSecretKey,
    encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  };
};
```

Note: `encryptionKey` is optional — when empty, auth codes are stored as-is (backward compatible for dev). Only encrypts when key is set.

**Step 5: Encrypt auth code on save in webhook handler**

In `src/payments/payments.service.ts`, import and use encryption:

```typescript
import { encrypt } from '../common/utils/encryption.util';

// In constructor, also read encryptionKey:
private readonly encryptionKey: string;
// ...
this.encryptionKey = paymentConfig.encryptionKey;
```

In `handleWebhook`, where auth code is saved (around line 131):
```typescript
if (channel === 'card' && authorization?.authorization_code) {
  updateData.paystackAuthorizationCode = this.encryptionKey
    ? encrypt(authorization.authorization_code, this.encryptionKey)
    : authorization.authorization_code;
  updateData.paymentMethod = 'CARD';
}
```

**Step 6: Decrypt auth code on read in billing service**

In `src/billing/billing.service.ts`, decrypt before passing to `chargeAuthorization`:

```typescript
import { decrypt } from '../common/utils/encryption.util';
import { PaymentConfig, getPaymentConfigName } from '../common/config/payment.config';

// In constructor, also read encryptionKey:
private readonly encryptionKey: string;
// ...
this.encryptionKey = this.configService.get<PaymentConfig>(getPaymentConfigName())!.encryptionKey;
```

In `processCardRenewals`, decrypt before use (around line 90):
```typescript
const authCode = this.encryptionKey
  ? decrypt(sub.paystackAuthorizationCode!, this.encryptionKey)
  : sub.paystackAuthorizationCode!;

await this.paymentsService.chargeAuthorization(
  sub.id,
  authCode,
  sub.primaryMember.email,
  sub.plan.price,
);
```

**Step 7: Update billing tests**

Update `billing.service.spec.ts` mock config to include `encryptionKey`:
```typescript
const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'app') return { adminUrl: 'http://localhost:3001' };
    if (key === 'payment') return { paystackSecretKey: 'sk_test', encryptionKey: '' };
    return {};
  }),
};
```

**Step 8: Run tests**

Run: `yarn test -- --testPathPattern="billing|encryption"`
Expected: All tests pass

**Step 9: Commit**

```bash
git add src/common/utils/encryption.util.ts src/common/utils/encryption.util.spec.ts \
  src/common/config/payment.config.ts src/payments/payments.service.ts \
  src/billing/billing.service.ts src/billing/billing.service.spec.ts
git commit -m "fix(security): encrypt paystackAuthorizationCode at rest with AES-256-GCM"
```

---

### Task 4: Add Request Body Size Limits

**Files:**
- Modify: `src/main.ts`

**Step 1: Add body parser limits**

In `src/main.ts`, after creating the app, add body size limits. NestJS uses Express under the hood, so we configure via `NestFactory.create` options:

```typescript
const app = await NestFactory.create(AppModule, {
  rawBody: true,
  bodyParser: false, // disable default, we'll add our own
});

// Add body parsers with size limits
import { json, urlencoded } from 'express';
app.use(json({ limit: '1mb' }));
app.use(urlencoded({ extended: true, limit: '1mb' }));
```

Wait — `rawBody: true` requires the default body parser. Instead, use the `NestFactory.create` options which accept `rawBody` and we override the default parsers separately. Actually, the cleaner approach for NestJS with `rawBody: true` is:

```typescript
const app = await NestFactory.create(AppModule, { rawBody: true });
// Override body parser limits (Express underneath)
import { json, urlencoded } from 'express';
app.use(json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
app.use(urlencoded({ extended: true, limit: '1mb' }));
```

Hmm, but NestJS's `rawBody: true` already handles the raw body capture internally. The simplest correct approach is to just pass the limit through NestFactory options:

```typescript
const app = await NestFactory.create(AppModule, {
  rawBody: true,
  jsonBodyLimit: '1mb',
});
```

NestJS 11 does not support `jsonBodyLimit` directly. The safest approach: keep `rawBody: true` and add Express middleware before other middleware:

In `src/main.ts`, add after `const app = ...`:
```typescript
import * as bodyParser from 'body-parser';

// Body size limits (must come before other middleware)
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));
```

Actually, `body-parser` is deprecated in favor of Express built-in. Use `express.json` and `express.urlencoded`. But with `rawBody: true`, NestJS handles parsing internally. The correct approach is:

```typescript
const app = await NestFactory.create(AppModule, { rawBody: true });
const expressApp = app.getHttpAdapter().getInstance();
// These override the default parsers with size limits
expressApp.use(express.json({ limit: '1mb' }));
expressApp.use(express.urlencoded({ limit: '1mb', extended: true }));
```

Simplest: since `rawBody: true` sets up its own body parser, we just need to set limits. Looking at NestJS source, `rawBody` uses `{ limit }` from adapter options. The cleanest way is to register the app with adapter options. But let's just use the most straightforward approach that's documented to work:

```typescript
// In main.ts, after app creation:
app.useBodyParser('json', { limit: '1mb' });
app.useBodyParser('urlencoded', { limit: '1mb' });
```

`NestExpressApplication.useBodyParser()` is the official NestJS API for this.

**Step 2: Run the build to verify**

Run: `yarn build`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add src/main.ts
git commit -m "fix(security): add 1mb request body size limits"
```

---

### Task 5: Add Pagination to findAll Endpoints

**Files:**
- Create: `src/common/dto/pagination-query.dto.ts`
- Modify: `src/users/users.service.ts:21-23`
- Modify: `src/users/users.controller.ts:25-28`
- Modify: `src/users/users.service.spec.ts`
- Modify: `src/trainers/trainers.service.ts:33-37`
- Modify: `src/trainers/trainers.controller.ts:26-29`
- Modify: `src/trainers/trainers.service.spec.ts`
- Modify: `src/legal/legal.service.ts:24-28`
- Modify: `src/legal/legal.controller.ts:39-42`
- Modify: `src/legal/legal.service.spec.ts`
- Modify: `src/subscription-plans/subscription-plans.service.ts:14-16`
- Modify: `src/subscription-plans/subscription-plans.controller.ts:37-41`

**Step 1: Create shared PaginationQueryDto**

Create `src/common/dto/pagination-query.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
```

**Step 2: Update UsersService.findAll**

```typescript
async findAll(page: number = 1, limit: number = 20) {
  const [data, total] = await Promise.all([
    this.prisma.user.findMany({
      select: safeUserSelect,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.user.count(),
  ]);
  return { data, total, page, limit };
}
```

**Step 3: Update UsersController.findAll**

```typescript
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Get()
findAll(@Query() query: PaginationQueryDto) {
  return this.usersService.findAll(query.page, query.limit);
}
```

Add `Query` to the `@nestjs/common` import.

**Step 4: Update users service test**

In `src/users/users.service.spec.ts`, update the `findAll` test to handle the new signature and `count` mock:

```typescript
// Add to mockPrisma.user:
count: jest.fn(),

// Update test:
it('should return paginated users', async () => {
  const users = [{ id: '1', email: 'test@test.com' }];
  mockPrisma.user.findMany.mockResolvedValue(users);
  mockPrisma.user.count.mockResolvedValue(1);

  const result = await service.findAll(1, 20);
  expect(result).toEqual({ data: users, total: 1, page: 1, limit: 20 });
});
```

**Step 5: Run users tests**

Run: `yarn test -- --testPathPattern=users`
Expected: PASS

**Step 6: Update TrainersService.findAll**

```typescript
async findAll(page: number = 1, limit: number = 20) {
  const [data, total] = await Promise.all([
    this.prisma.trainerProfile.findMany({
      include: { user: { select: safeUserSelect }, schedules: true },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.trainerProfile.count(),
  ]);
  return { data, total, page, limit };
}
```

**Step 7: Update TrainersController.findAll**

```typescript
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Get()
findAll(@Query() query: PaginationQueryDto) {
  return this.trainersService.findAll(query.page, query.limit);
}
```

Add `Query` to imports.

**Step 8: Update trainers service test**

Add `count` to the mock and update assertions similarly.

**Step 9: Run trainers tests**

Run: `yarn test -- --testPathPattern=trainers`
Expected: PASS

**Step 10: Update LegalService.findAll**

```typescript
async findAll(page: number = 1, limit: number = 20) {
  const [data, total] = await Promise.all([
    this.prisma.legalDocument.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.legalDocument.count(),
  ]);
  return { data, total, page, limit };
}
```

**Step 11: Update LegalController.findAll**

```typescript
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Get()
findAll(@Query() query: PaginationQueryDto) {
  return this.legalService.findAll(query.page, query.limit);
}
```

Add `Query` to imports.

**Step 12: Update legal service test**

Add `count` to the mock and update assertions.

**Step 13: Run legal tests**

Run: `yarn test -- --testPathPattern=legal`
Expected: PASS

**Step 14: Update SubscriptionPlansService.findAll**

```typescript
async findAll(page: number = 1, limit: number = 20) {
  const [data, total] = await Promise.all([
    this.prisma.subscriptionPlan.findMany({
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.subscriptionPlan.count(),
  ]);
  return { data, total, page, limit };
}
```

**Step 15: Update SubscriptionPlansController.findAll**

```typescript
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Get('all')
@Roles('ADMIN', 'SUPER_ADMIN')
findAll(@Query() query: PaginationQueryDto) {
  return this.plansService.findAll(query.page, query.limit);
}
```

Add `Query` to imports.

**Step 16: Run all tests**

Run: `yarn test`
Expected: All tests pass

**Step 17: Commit**

```bash
git add src/common/dto/pagination-query.dto.ts \
  src/users/users.service.ts src/users/users.controller.ts src/users/users.service.spec.ts \
  src/trainers/trainers.service.ts src/trainers/trainers.controller.ts src/trainers/trainers.service.spec.ts \
  src/legal/legal.service.ts src/legal/legal.controller.ts src/legal/legal.service.spec.ts \
  src/subscription-plans/subscription-plans.service.ts src/subscription-plans/subscription-plans.controller.ts
git commit -m "fix(security): add pagination to findAll endpoints (max 100 per page)"
```

---

### Task 6: Update Handover Doc and CLAUDE.md

**Files:**
- Modify: `docs/plans/HANDOVER.md`
- Modify: `CLAUDE.md`

**Step 1: Replace the "Security — Remaining Items" section in HANDOVER.md with a tracking table**

Replace lines 149-169 with a table showing status for all items.

**Step 2: Update CLAUDE.md with new env vars and patterns**

Add `ENCRYPTION_KEY` to the environment variables section. Update the security section.

**Step 3: Commit**

```bash
git add docs/plans/HANDOVER.md CLAUDE.md
git commit -m "docs: update handover and CLAUDE.md with security phase 2 results"
```
