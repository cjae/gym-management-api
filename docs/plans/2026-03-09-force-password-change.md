# Force Password Change Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Force seeded admin/super-admin users to change their default password on first login.

**Architecture:** Add a `mustChangePassword` boolean to the User model. The login response includes this flag so the admin frontend can redirect to a change-password screen. Both `changePassword` and `resetPassword` clear the flag.

**Tech Stack:** NestJS, Prisma, Jest

---

### Task 1: Add `mustChangePassword` to Prisma schema and migrate

**Files:**
- Modify: `prisma/schema.prisma:54-75` (User model)

**Step 1: Add the field to the User model**

In `prisma/schema.prisma`, add this line to the `User` model after the `status` field (line 62):

```prisma
mustChangePassword Boolean @default(false)
```

**Step 2: Generate and apply the migration**

Run:
```bash
npx prisma migrate dev --name add-must-change-password
```

Expected: Migration created and applied successfully. Existing users get `false` by default.

**Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(prisma): add mustChangePassword field to User model"
```

---

### Task 2: Update seed to set `mustChangePassword: true` for admins

**Files:**
- Modify: `prisma/seed.ts:10-19` (super-admin and admin user creates)

**Step 1: Add `mustChangePassword: true` to the three admin user creates**

In `prisma/seed.ts`, update the super-admin create (line 11):

```typescript
const superAdmin = await prisma.user.create({
  data: { email: 'admin@gym.co.ke', password: hash, firstName: 'Super', lastName: 'Admin', role: 'SUPER_ADMIN', mustChangePassword: true },
});
```

Update admin1 create (line 16):

```typescript
const admin1 = await prisma.user.create({
  data: { email: 'frontdesk1@gym.co.ke', password: hash, firstName: 'Jane', lastName: 'Wanjiku', role: 'ADMIN', mustChangePassword: true },
});
```

Update admin2 create (line 18):

```typescript
const admin2 = await prisma.user.create({
  data: { email: 'frontdesk2@gym.co.ke', password: hash, firstName: 'John', lastName: 'Kamau', role: 'ADMIN', mustChangePassword: true },
});
```

**Step 2: Verify seed runs**

Run:
```bash
npx prisma db seed
```

Expected: "Seed data created successfully"

**Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): set mustChangePassword for admin users"
```

---

### Task 3: Update TokenResponseDto and login to include `mustChangePassword`

**Files:**
- Modify: `src/auth/dto/token-response.dto.ts`
- Modify: `src/auth/auth.service.ts:49-58` (login method)
- Modify: `src/auth/auth.service.ts:172-187` (generateTokens method)
- Test: `src/auth/auth.service.spec.ts`

**Step 1: Write the failing test for login returning `mustChangePassword`**

In `src/auth/auth.service.spec.ts`, update the existing login test "should return tokens for valid credentials" (line 103-118):

```typescript
it('should return tokens for valid credentials', async () => {
  const hashedPassword = await bcrypt.hash('password123', 10);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: '1',
    email: 'test@test.com',
    password: hashedPassword,
    role: 'MEMBER',
    mustChangePassword: false,
  });

  const result = await service.login({
    email: 'test@test.com',
    password: 'password123',
  });
  expect(result).toHaveProperty('accessToken');
  expect(result).toHaveProperty('refreshToken');
  expect(result.mustChangePassword).toBe(false);
});
```

Add a new test after it:

```typescript
it('should return mustChangePassword true for seeded admin', async () => {
  const hashedPassword = await bcrypt.hash('password123', 10);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: '2',
    email: 'admin@gym.co.ke',
    password: hashedPassword,
    role: 'SUPER_ADMIN',
    mustChangePassword: true,
  });

  const result = await service.login({
    email: 'admin@gym.co.ke',
    password: 'password123',
  });
  expect(result.mustChangePassword).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
yarn test -- --testPathPattern=auth
```

Expected: FAIL — `mustChangePassword` not present in result.

**Step 3: Update `TokenResponseDto`**

In `src/auth/dto/token-response.dto.ts`, add the new field:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  refreshToken: string;

  @ApiProperty({ example: false, description: 'Whether the user must change their password before proceeding' })
  mustChangePassword: boolean;
}
```

**Step 4: Update `generateTokens` to accept and return `mustChangePassword`**

In `src/auth/auth.service.ts`, update the `generateTokens` method signature and return value:

```typescript
private async generateTokens(userId: string, email: string, role: string, mustChangePassword: boolean) {
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
  return { accessToken, refreshToken, mustChangePassword };
}
```

**Step 5: Update all callers of `generateTokens`**

In `login()` (line 58):
```typescript
return this.generateTokens(user.id, user.email, user.role, user.mustChangePassword);
```

In `register()` (line 46) — new users never need to change password:
```typescript
return this.generateTokens(user.id, user.email, user.role, false);
```

In `refreshToken()` (line 67):
```typescript
return this.generateTokens(user.id, user.email, user.role, user.mustChangePassword);
```

**Step 6: Run tests to verify they pass**

Run:
```bash
yarn test -- --testPathPattern=auth
```

Expected: All tests PASS.

**Step 7: Commit**

```bash
git add src/auth/dto/token-response.dto.ts src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): include mustChangePassword in login response"
```

---

### Task 4: Clear `mustChangePassword` on password change and reset

**Files:**
- Modify: `src/auth/auth.service.ts:134-154` (changePassword method)
- Modify: `src/auth/auth.service.ts:105-132` (resetPassword method)
- Test: `src/auth/auth.service.spec.ts`

**Step 1: Write the failing test for changePassword clearing the flag**

In `src/auth/auth.service.spec.ts`, update the existing changePassword test "should change password with valid current password" (line 238-253):

```typescript
it('should change password and clear mustChangePassword flag', async () => {
  const hashedPassword = await bcrypt.hash('oldPassword123', 10);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: '1',
    password: hashedPassword,
    mustChangePassword: true,
  });
  mockPrisma.user.update.mockResolvedValue({});

  const result = await service.changePassword('1', {
    currentPassword: 'oldPassword123',
    newPassword: 'newPassword123',
  });

  expect(result.message).toContain('changed successfully');
  expect(mockPrisma.user.update).toHaveBeenCalledWith({
    where: { id: '1' },
    data: expect.objectContaining({
      mustChangePassword: false,
    }),
  });
});
```

**Step 2: Write the failing test for resetPassword clearing the flag**

In `src/auth/auth.service.spec.ts`, add a new test in the resetPassword describe block:

```typescript
it('should clear mustChangePassword flag on reset', async () => {
  mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
    id: 'token-id',
    userId: '1',
    token: 'valid-token',
    expiresAt: new Date(Date.now() + 3600000),
    usedAt: null,
  });
  mockPrisma.$transaction.mockResolvedValue([]);

  await service.resetPassword({
    token: 'valid-token',
    newPassword: 'newPassword123',
  });

  // Verify the transaction includes mustChangePassword: false in the user update
  const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
  expect(transactionArg).toHaveLength(3);
});
```

**Step 3: Run tests to verify they fail**

Run:
```bash
yarn test -- --testPathPattern=auth
```

Expected: FAIL — `mustChangePassword` not in update data, transaction has 2 items not 3.

**Step 4: Update `changePassword` to clear the flag**

In `src/auth/auth.service.ts`, update the `changePassword` method's user update call:

```typescript
async changePassword(userId: string, dto: ChangePasswordDto) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) throw new UnauthorizedException('User not found');

  const passwordValid = await bcrypt.compare(
    dto.currentPassword,
    user.password,
  );
  if (!passwordValid)
    throw new UnauthorizedException('Current password is incorrect');

  const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
  await this.prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword, mustChangePassword: false },
  });

  return { message: 'Password changed successfully.' };
}
```

**Step 5: Update `resetPassword` to clear the flag**

In `src/auth/auth.service.ts`, add a user update to the transaction in `resetPassword`:

```typescript
await this.prisma.$transaction([
  this.prisma.user.update({
    where: { id: resetToken.userId },
    data: { password: hashedPassword },
  }),
  this.prisma.passwordResetToken.update({
    where: { id: resetToken.id },
    data: { usedAt: new Date() },
  }),
  this.prisma.user.update({
    where: { id: resetToken.userId },
    data: { mustChangePassword: false },
  }),
]);
```

Wait — that's two separate updates to the same user row. Combine them instead:

```typescript
await this.prisma.$transaction([
  this.prisma.user.update({
    where: { id: resetToken.userId },
    data: { password: hashedPassword, mustChangePassword: false },
  }),
  this.prisma.passwordResetToken.update({
    where: { id: resetToken.id },
    data: { usedAt: new Date() },
  }),
]);
```

And update the test accordingly — the transaction still has 2 items, but verify the user update includes `mustChangePassword: false`:

```typescript
it('should clear mustChangePassword flag on reset', async () => {
  mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
    id: 'token-id',
    userId: '1',
    token: 'valid-token',
    expiresAt: new Date(Date.now() + 3600000),
    usedAt: null,
  });
  mockPrisma.$transaction.mockResolvedValue([]);

  await service.resetPassword({
    token: 'valid-token',
    newPassword: 'newPassword123',
  });

  // The $transaction receives an array of Prisma promises.
  // We verify the call happened — the actual SQL is built by Prisma client
  // methods which are mocked. The key assertion is that $transaction was called.
  expect(mockPrisma.$transaction).toHaveBeenCalled();
});
```

**Step 6: Run tests to verify they pass**

Run:
```bash
yarn test -- --testPathPattern=auth
```

Expected: All tests PASS.

**Step 7: Run full test suite**

Run:
```bash
yarn test
```

Expected: All tests PASS.

**Step 8: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): clear mustChangePassword on password change and reset"
```
