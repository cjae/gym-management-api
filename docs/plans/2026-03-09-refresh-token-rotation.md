# Refresh Token Rotation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `POST /auth/refresh` endpoint with token rotation — each refresh invalidates the old refresh token and issues a new pair.

**Architecture:** New `JwtRefreshStrategy` validates refresh tokens using `JWT_REFRESH_SECRET`. The `refreshToken()` service method is updated to accept and invalidate the old JTI. Endpoint uses both `BasicAuthGuard` and `JwtRefreshAuthGuard`.

**Tech Stack:** NestJS, Passport (`passport-jwt`), `@nestjs/jwt`, Prisma

---

### Task 1: Create RefreshTokenDto

**Files:**
- Create: `src/auth/dto/refresh-token.dto.ts`

**Step 1: Create the DTO**

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token from login/register' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
```

**Step 2: Commit**

```bash
git add src/auth/dto/refresh-token.dto.ts
git commit -m "feat(auth): add RefreshTokenDto"
```

---

### Task 2: Create JwtRefreshStrategy and Guard

**Files:**
- Create: `src/auth/strategies/jwt-refresh.strategy.ts`
- Create: `src/auth/guards/jwt-refresh-auth.guard.ts`
- Modify: `src/auth/auth.module.ts`

**Step 1: Create the JwtRefreshStrategy**

This strategy extracts the refresh token from the request body, validates it with `JWT_REFRESH_SECRET`, and checks the JTI blocklist.

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthConfig, getAuthConfigName } from '../../common/config/auth.config';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    const authConfig = configService.get<AuthConfig>(getAuthConfigName())!;
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: authConfig.jwtRefreshSecret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    jti: string;
  }) {
    const invalidated = await this.prisma.invalidatedToken.findUnique({
      where: { jti: payload.jti },
    });

    if (invalidated) {
      throw new UnauthorizedException('Refresh token has been invalidated');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
    };
  }
}
```

**Step 2: Create JwtRefreshAuthGuard**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtRefreshAuthGuard extends AuthGuard('jwt-refresh') {}
```

**Step 3: Register JwtRefreshStrategy in AuthModule**

In `src/auth/auth.module.ts`, add `JwtRefreshStrategy` to the `providers` array:

```typescript
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

// In providers array:
providers: [AuthService, JwtStrategy, BasicStrategy, JwtRefreshStrategy],
```

**Step 4: Commit**

```bash
git add src/auth/strategies/jwt-refresh.strategy.ts src/auth/guards/jwt-refresh-auth.guard.ts src/auth/auth.module.ts
git commit -m "feat(auth): add JwtRefreshStrategy and guard"
```

---

### Task 3: Update AuthService.refreshToken() for Token Rotation

**Files:**
- Modify: `src/auth/auth.service.ts:68-79`

**Step 1: Write the failing test**

Add to `src/auth/auth.service.spec.ts` in the existing `describe('refreshToken')` block. Replace the existing test and add new ones:

```typescript
describe('refreshToken', () => {
  it('should invalidate old JTI and return new tokens', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      role: 'MEMBER',
      mustChangePassword: false,
    });
    mockPrisma.invalidatedToken.create.mockResolvedValue({});

    const result = await service.refreshToken('1', 'old-refresh-jti');

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(mockPrisma.invalidatedToken.create).toHaveBeenCalledWith({
      data: {
        jti: 'old-refresh-jti',
        expiresAt: expect.any(Date) as Date,
      },
    });
  });

  it('should throw UnauthorizedException if user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.refreshToken('nonexistent', 'some-jti'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should return mustChangePassword from user record', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'admin@gym.co.ke',
      role: 'SUPER_ADMIN',
      mustChangePassword: true,
    });
    mockPrisma.invalidatedToken.create.mockResolvedValue({});

    const result = await service.refreshToken('1', 'old-jti');
    expect(result.mustChangePassword).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=auth.service`
Expected: FAIL — `refreshToken` only takes 1 argument

**Step 3: Update the service method**

Replace `refreshToken` method in `src/auth/auth.service.ts`:

```typescript
async refreshToken(userId: string, oldRefreshJti: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) throw new UnauthorizedException('User not found');

  // Invalidate old refresh token (rotation)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await this.prisma.invalidatedToken.create({
    data: { jti: oldRefreshJti, expiresAt },
  });

  return this.generateTokens(
    user.id,
    user.email,
    user.role,
    user.mustChangePassword,
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=auth.service`
Expected: PASS

**Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): add token rotation to refreshToken method"
```

---

### Task 4: Add Refresh Endpoint to Controller

**Files:**
- Modify: `src/auth/auth.controller.ts`

**Step 1: Add the refresh endpoint**

Add these imports at the top of `auth.controller.ts`:

```typescript
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';
```

Add the endpoint after the `login` method:

```typescript
@Post('refresh')
@UseGuards(BasicAuthGuard, JwtRefreshAuthGuard)
@ApiBasicAuth()
@ApiOkResponse({
  type: TokenResponseDto,
  description: 'Tokens refreshed successfully',
})
@ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
@Throttle({ default: { limit: 30, ttl: 60000 } })
refresh(
  @CurrentUser('id') userId: string,
  @CurrentUser('jti') jti: string,
  @Body() _dto: RefreshTokenDto,
) {
  return this.authService.refreshToken(userId, jti);
}
```

Note: `_dto` is needed so NestJS parses the body (the strategy reads from body), and for Swagger docs. The `@CurrentUser` extracts from the validated JWT payload.

**Step 2: Run full test suite**

Run: `yarn test`
Expected: All tests pass

**Step 3: Run lint**

Run: `yarn lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/auth/auth.controller.ts
git commit -m "feat(auth): add POST /auth/refresh endpoint with token rotation"
```

---

### Task 5: Manual Verification

**Step 1: Start dev server**

Run: `yarn start:dev`

**Step 2: Test the flow**

1. Login to get tokens: `POST /api/v1/auth/login`
2. Use refresh token: `POST /api/v1/auth/refresh` with `{ "refreshToken": "..." }`
3. Verify new tokens returned
4. Try reusing the old refresh token — should get 401
5. Check Swagger docs at `/api/docs` — refresh endpoint should appear

**Step 3: Commit any fixes if needed**
