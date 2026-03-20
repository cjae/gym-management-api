# Referral System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let members refer others via a unique code and earn free subscription days when the referred user's first payment succeeds.

**Architecture:** New `referrals` module with service/controller/DTOs. Schema additions to User (referralCode, referredById), new Referral model, GymSettings fields. Webhook triggers reward. Email + push notification on reward.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest, Handlebars email templates

**Design doc:** `docs/plans/2026-03-15-referral-system-design.md`

---

### Task 1: Schema — Add Referral model, enums, and field additions

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add ReferralStatus enum after existing enums (after line 86)**

Add after the `AuditAction` enum:

```prisma
enum ReferralStatus {
  PENDING
  COMPLETED
}
```

**Step 2: Add REFERRAL_REWARD to NotificationType enum (line 67-74)**

Change:
```prisma
enum NotificationType {
  GENERAL
  STREAK_NUDGE
  STATUS_CHANGE
  PAYMENT_REMINDER
  SUBSCRIPTION_EXPIRING
  BIRTHDAY
}
```
To:
```prisma
enum NotificationType {
  GENERAL
  STREAK_NUDGE
  STATUS_CHANGE
  PAYMENT_REMINDER
  SUBSCRIPTION_EXPIRING
  BIRTHDAY
  REFERRAL_REWARD
}
```

**Step 3: Add referral fields to User model (after line 131)**

Add these fields and relations to the User model:

```prisma
  referralCode               String?          @unique
  referredById               String?
  referredBy                 User?            @relation("UserReferrals", fields: [referredById], references: [id])
  referrals                  User[]           @relation("UserReferrals")
  referralsMade              Referral[]       @relation("ReferrerReferrals")
  referralReceived           Referral?        @relation("ReferredReferral")
```

**Step 4: Add referral settings to GymSettings model (after line 381)**

Add to the GymSettings model:

```prisma
  referralRewardDays       Int      @default(7)
  maxReferralsPerCycle     Int      @default(3)
```

**Step 5: Add Referral model (after GymSettings, before Notification)**

```prisma
model Referral {
  id          String         @id @default(uuid())
  referrerId  String
  referredId  String         @unique
  status      ReferralStatus @default(PENDING)
  rewardDays  Int            @default(0)
  completedAt DateTime?

  referrer User @relation("ReferrerReferrals", fields: [referrerId], references: [id])
  referred User @relation("ReferredReferral", fields: [referredId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([referrerId, createdAt])
}
```

**Step 6: Create and apply migration**

Run: `npx prisma migrate dev --name add-referral-system`
Expected: Migration created and applied, Prisma client regenerated.

**Step 7: Commit**

```bash
git add prisma/
git commit -m "feat(referral): add Referral model, ReferralStatus enum, and schema fields"
```

---

### Task 2: GymSettings — Add referral config fields to DTOs and response

**Files:**
- Modify: `src/gym-settings/dto/upsert-gym-settings.dto.ts`
- Modify: `src/gym-settings/dto/gym-settings-response.dto.ts`

**Step 1: Add referral fields to UpsertGymSettingsDto**

In `src/gym-settings/dto/upsert-gym-settings.dto.ts`, add:

```typescript
import { IsString, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertGymSettingsDto {
  @ApiPropertyOptional({
    example: 'Africa/Nairobi',
    description: 'IANA timezone identifier',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @ApiPropertyOptional({
    example: 7,
    description: 'Free days earned per successful referral',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  referralRewardDays?: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Max referral rewards per billing cycle',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxReferralsPerCycle?: number;
}
```

**Step 2: Add referral fields to GymSettingsResponseDto**

In `src/gym-settings/dto/gym-settings-response.dto.ts`, add to `GymSettingsResponseDto`:

```typescript
  @ApiProperty({ example: 7, description: 'Free days per referral' })
  referralRewardDays: number;

  @ApiProperty({ example: 3, description: 'Max referrals rewarded per billing cycle' })
  maxReferralsPerCycle: number;
```

**Step 3: Update GymSettingsService.upsert() to handle new fields**

In `src/gym-settings/gym-settings.service.ts`, update the `upsert` method's `update` clause to include referral fields:

```typescript
  async upsert(dto: UpsertGymSettingsDto) {
    if (dto.timezone) {
      this.validateTimezone(dto.timezone);
    }
    const settings = await this.prisma.gymSettings.upsert({
      where: { id: 'singleton' },
      create: {
        timezone: dto.timezone ?? 'Africa/Nairobi',
        ...(dto.referralRewardDays !== undefined && { referralRewardDays: dto.referralRewardDays }),
        ...(dto.maxReferralsPerCycle !== undefined && { maxReferralsPerCycle: dto.maxReferralsPerCycle }),
      },
      update: {
        ...(dto.timezone && { timezone: dto.timezone }),
        ...(dto.referralRewardDays !== undefined && { referralRewardDays: dto.referralRewardDays }),
        ...(dto.maxReferralsPerCycle !== undefined && { maxReferralsPerCycle: dto.maxReferralsPerCycle }),
      },
      include: { offPeakWindows: true },
    });
    this.invalidateCache();
    return settings;
  }
```

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern=gym-settings`
Expected: All existing gym-settings tests pass.

**Step 5: Commit**

```bash
git add src/gym-settings/
git commit -m "feat(referral): add referral config to gym settings DTOs and service"
```

---

### Task 3: Referral code generation — Add to user creation paths

**Files:**
- Modify: `src/auth/auth.service.ts`
- Modify: `src/users/users.service.ts`

**Step 1: Add referral code generator utility**

Create `src/common/utils/referral-code.util.ts`:

```typescript
import { randomBytes } from 'crypto';

export function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
}
```

**Step 2: Generate referral code in AuthService.register()**

In `src/auth/auth.service.ts`, import the utility and add `referralCode` to the user create data (line 60-70):

```typescript
import { generateReferralCode } from '../common/utils/referral-code.util';
```

Update the `prisma.user.create` call in `register()` to include `referralCode`:

```typescript
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        referralCode: generateReferralCode(),
        tosAcceptedAt: now,
        waiverAcceptedAt: now,
      },
    });
```

Handle unique constraint collision — wrap with retry:

```typescript
    let user: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        user = await this.prisma.user.create({
          data: {
            email: dto.email,
            password: hashedPassword,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            referralCode: generateReferralCode(),
            tosAcceptedAt: now,
            waiverAcceptedAt: now,
          },
        });
        break;
      } catch (error: unknown) {
        if (
          error instanceof Object &&
          'code' in error &&
          error.code === 'P2002' &&
          error instanceof Object &&
          'meta' in error &&
          (error.meta as any)?.target?.includes('referralCode')
        ) {
          if (attempt === 2) throw error;
          continue;
        }
        throw error;
      }
    }
```

**Step 3: Generate referral code in UsersService.create()**

In `src/users/users.service.ts`, import the utility and add `referralCode` to the user create data (line 67-77). Same retry pattern as above.

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern="auth|users"`
Expected: Tests pass (mocks won't care about the new field).

**Step 5: Commit**

```bash
git add src/common/utils/referral-code.util.ts src/auth/auth.service.ts src/users/users.service.ts
git commit -m "feat(referral): generate unique referral code on user creation"
```

---

### Task 4: Registration — Accept referralCode and create Referral record

**Files:**
- Modify: `src/auth/dto/register.dto.ts`
- Modify: `src/auth/auth.service.ts`

**Step 1: Add referralCode to RegisterDto**

In `src/auth/dto/register.dto.ts`, add after the `phone` field:

```typescript
  @ApiPropertyOptional({
    example: 'A1B2C3D4',
    description: 'Referral code from an existing member',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  referralCode?: string;
```

**Step 2: Handle referral in AuthService.register()**

After user creation in `register()`, add referral logic:

```typescript
    // Handle referral (soft fail — invalid codes don't block registration)
    if (dto.referralCode) {
      try {
        const referrer = await this.prisma.user.findUnique({
          where: { referralCode: dto.referralCode },
        });
        if (referrer && referrer.status === 'ACTIVE' && referrer.id !== user.id) {
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: user.id },
              data: { referredById: referrer.id },
            }),
            this.prisma.referral.create({
              data: {
                referrerId: referrer.id,
                referredId: user.id,
              },
            }),
          ]);
        }
      } catch {
        // Soft fail — don't block registration for referral issues
      }
    }
```

**Step 3: Run tests**

Run: `yarn test -- --testPathPattern=auth`
Expected: Existing tests still pass.

**Step 4: Commit**

```bash
git add src/auth/dto/register.dto.ts src/auth/auth.service.ts
git commit -m "feat(referral): accept referral code during registration"
```

---

### Task 5: Referral reward — Trigger on first payment in webhook

**Files:**
- Modify: `src/payments/payments.service.ts`
- Modify: `src/payments/payments.module.ts`

**Step 1: Import dependencies in PaymentsModule**

In `src/payments/payments.module.ts`, import GymSettingsModule, NotificationsModule, and EmailModule:

```typescript
import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [GymSettingsModule, NotificationsModule, EmailModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
```

**Step 2: Inject services in PaymentsService constructor**

In `src/payments/payments.service.ts`, add imports and constructor params:

```typescript
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
```

Add to constructor:

```typescript
  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gymSettingsService: GymSettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {
```

**Step 3: Add processReferralReward private method**

Add to `PaymentsService`:

```typescript
  private async processReferralReward(payingUserId: string) {
    // Check if this user has a pending referral
    const referral = await this.prisma.referral.findUnique({
      where: { referredId: payingUserId },
      include: {
        referrer: true,
        referred: true,
      },
    });

    if (!referral || referral.status !== 'PENDING') return;

    // Get referrer's active subscription
    const referrerSubscription =
      await this.prisma.memberSubscription.findFirst({
        where: {
          primaryMemberId: referral.referrerId,
          status: 'ACTIVE',
        },
      });

    const settings = await this.gymSettingsService.getCachedSettings();
    const rewardDays = settings?.referralRewardDays ?? 7;
    const maxPerCycle = settings?.maxReferralsPerCycle ?? 3;

    // Check cycle cap: count completed referrals with rewards in current billing cycle
    let earnedDays = 0;
    if (referrerSubscription) {
      const cycleStart = referrerSubscription.startDate;
      const completedInCycle = await this.prisma.referral.count({
        where: {
          referrerId: referral.referrerId,
          status: 'COMPLETED',
          rewardDays: { gt: 0 },
          completedAt: { gte: cycleStart },
        },
      });

      if (completedInCycle < maxPerCycle) {
        earnedDays = rewardDays;

        // Extend subscription
        const newEndDate = new Date(referrerSubscription.endDate);
        newEndDate.setDate(newEndDate.getDate() + rewardDays);
        const newBillingDate = referrerSubscription.nextBillingDate
          ? new Date(referrerSubscription.nextBillingDate)
          : null;
        if (newBillingDate) {
          newBillingDate.setDate(newBillingDate.getDate() + rewardDays);
        }

        await this.prisma.memberSubscription.update({
          where: { id: referrerSubscription.id },
          data: {
            endDate: newEndDate,
            ...(newBillingDate && { nextBillingDate: newBillingDate }),
          },
        });
      }
    }

    // Mark referral completed regardless
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'COMPLETED',
        rewardDays: earnedDays,
        completedAt: new Date(),
      },
    });

    // Send notifications only if reward was earned
    if (earnedDays > 0) {
      const referredName = `${referral.referred.firstName} ${referral.referred.lastName}`;

      // Push + in-app notification
      this.notificationsService
        .create({
          userId: referral.referrerId,
          title: 'Referral reward earned!',
          body: `${referredName} joined — you earned ${earnedDays} free days!`,
          type: 'REFERRAL_REWARD',
          metadata: {
            referredId: referral.referredId,
            referredName,
            rewardDays: earnedDays,
          },
        })
        .catch((err) =>
          this.logger.error(`Failed to send referral notification: ${err}`),
        );

      // Email notification
      this.emailService
        .sendReferralRewardEmail(
          referral.referrer.email,
          referral.referrer.firstName,
          referredName,
          earnedDays,
        )
        .catch((err) =>
          this.logger.error(`Failed to send referral email: ${err}`),
        );
    }
  }
```

**Step 4: Call processReferralReward in handleWebhook**

In `handleWebhook()`, after the subscription is updated to ACTIVE (after line 216), add:

```typescript
          // Process referral reward if applicable
          this.processReferralReward(subscription.primaryMemberId).catch(
            (err) =>
              this.logger.error(`Failed to process referral reward: ${err}`),
          );
```

**Step 5: Run tests**

Run: `yarn test -- --testPathPattern=payments`
Expected: Existing tests pass (mock the new dependencies).

**Step 6: Commit**

```bash
git add src/payments/
git commit -m "feat(referral): trigger reward on first payment via webhook"
```

---

### Task 6: Email template — Create referral-reward email

**Files:**
- Create: `src/email/templates/referral-reward.hbs`
- Modify: `src/email/email.service.ts`

**Step 1: Create email template**

Create `src/email/templates/referral-reward.hbs`:

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f0f0f0;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    {{> header}}

    <div style="padding: 32px 24px;">
      <h2 style="color: #333333; margin: 0 0 16px 0;">You earned free days!</h2>
      <p style="color: #555555; line-height: 1.6; margin: 0 0 8px 0;">Hi {{firstName}},</p>
      <p style="color: #555555; line-height: 1.6; margin: 0 0 24px 0;">Great news! Your friend <strong>{{referredName}}</strong> just joined the gym. You've earned <strong>{{rewardDays}} free days</strong> on your subscription.</p>

      <div style="background-color: #f5f5f5; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px 0;">
        <p style="color: #555555; margin: 0;"><strong>Reward:</strong> {{rewardDays}} free days added to your subscription</p>
      </div>

      <p style="color: #555555; line-height: 1.6; margin: 0 0 8px 0;">Keep referring friends to earn more free days!</p>
    </div>

    {{> footer}}
  </div>
</body>
</html>
```

**Step 2: Add sendReferralRewardEmail to EmailService**

In `src/email/email.service.ts`, add after `sendBirthdayEmail()` (after line 163):

```typescript
  async sendReferralRewardEmail(
    to: string,
    firstName: string,
    referredName: string,
    rewardDays: number,
  ): Promise<void> {
    await this.sendEmail(to, 'You earned free days!', 'referral-reward', {
      firstName,
      referredName,
      rewardDays,
    });
  }
```

**Step 3: Commit**

```bash
git add src/email/templates/referral-reward.hbs src/email/email.service.ts
git commit -m "feat(referral): add referral reward email template and service method"
```

---

### Task 7: Referrals module — Controller, service, DTOs

**Files:**
- Create: `src/referrals/referrals.module.ts`
- Create: `src/referrals/referrals.controller.ts`
- Create: `src/referrals/referrals.service.ts`
- Create: `src/referrals/dto/referral-response.dto.ts`
- Create: `src/referrals/dto/referral-stats-response.dto.ts`
- Modify: `src/app.module.ts`

**Step 1: Create ReferralsService**

Create `src/referrals/referrals.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

@Injectable()
export class ReferralsService {
  constructor(
    private prisma: PrismaService,
    private gymSettingsService: GymSettingsService,
  ) {}

  async getMyCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return { referralCode: user.referralCode };
  }

  async getMyReferrals(userId: string, page = 1, limit = 20) {
    const where = { referrerId: userId };
    const [referrals, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: {
          referred: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referral.count({ where }),
    ]);

    const data = referrals.map((r) => ({
      id: r.id,
      referredName: `${r.referred.firstName} ${r.referred.lastName}`,
      status: r.status,
      rewardDays: r.rewardDays,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    }));

    return { data, total, page, limit };
  }

  async getStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const settings = await this.gymSettingsService.getCachedSettings();
    const maxPerCycle = settings?.maxReferralsPerCycle ?? 3;
    const rewardDaysPerReferral = settings?.referralRewardDays ?? 7;

    const [totalReferrals, completedReferrals, totalDaysResult, subscription] =
      await Promise.all([
        this.prisma.referral.count({ where: { referrerId: userId } }),
        this.prisma.referral.count({
          where: { referrerId: userId, status: 'COMPLETED' },
        }),
        this.prisma.referral.aggregate({
          where: { referrerId: userId, status: 'COMPLETED' },
          _sum: { rewardDays: true },
        }),
        this.prisma.memberSubscription.findFirst({
          where: { primaryMemberId: userId, status: 'ACTIVE' },
        }),
      ]);

    let referralsThisCycle = 0;
    if (subscription) {
      referralsThisCycle = await this.prisma.referral.count({
        where: {
          referrerId: userId,
          status: 'COMPLETED',
          rewardDays: { gt: 0 },
          completedAt: { gte: subscription.startDate },
        },
      });
    }

    return {
      totalReferrals,
      completedReferrals,
      totalDaysEarned: totalDaysResult._sum.rewardDays ?? 0,
      referralsThisCycle,
      maxReferralsPerCycle: maxPerCycle,
      remainingThisCycle: Math.max(0, maxPerCycle - referralsThisCycle),
      rewardDaysPerReferral,
    };
  }
}
```

**Step 2: Create DTOs**

Create `src/referrals/dto/referral-response.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReferralStatus } from '@prisma/client';

export class ReferralResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Jane Doe' })
  referredName: string;

  @ApiProperty({ enum: ReferralStatus })
  status: ReferralStatus;

  @ApiProperty({ example: 7 })
  rewardDays: number;

  @ApiPropertyOptional()
  completedAt?: Date;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedReferralsResponseDto {
  @ApiProperty({ type: [ReferralResponseDto] })
  data: ReferralResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

export class ReferralCodeResponseDto {
  @ApiProperty({ example: 'A1B2C3D4' })
  referralCode: string;
}
```

Create `src/referrals/dto/referral-stats-response.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class ReferralStatsResponseDto {
  @ApiProperty({ example: 12 })
  totalReferrals: number;

  @ApiProperty({ example: 8 })
  completedReferrals: number;

  @ApiProperty({ example: 49 })
  totalDaysEarned: number;

  @ApiProperty({ example: 2 })
  referralsThisCycle: number;

  @ApiProperty({ example: 3 })
  maxReferralsPerCycle: number;

  @ApiProperty({ example: 1 })
  remainingThisCycle: number;

  @ApiProperty({ example: 7 })
  rewardDaysPerReferral: number;
}
```

**Step 3: Create ReferralsController**

Create `src/referrals/referrals.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ReferralCodeResponseDto, PaginatedReferralsResponseDto } from './dto/referral-response.dto';
import { ReferralStatsResponseDto } from './dto/referral-stats-response.dto';

@ApiTags('Referrals')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('my-code')
  @ApiOkResponse({ type: ReferralCodeResponseDto })
  getMyCode(@CurrentUser() user: { id: string }) {
    return this.referralsService.getMyCode(user.id);
  }

  @Get('my-referrals')
  @ApiOkResponse({ type: PaginatedReferralsResponseDto })
  getMyReferrals(
    @CurrentUser() user: { id: string },
    @Query() query: PaginationQueryDto,
  ) {
    return this.referralsService.getMyReferrals(
      user.id,
      query.page,
      query.limit,
    );
  }

  @Get('stats')
  @ApiOkResponse({ type: ReferralStatsResponseDto })
  getStats(@CurrentUser() user: { id: string }) {
    return this.referralsService.getStats(user.id);
  }
}
```

**Step 4: Create ReferralsModule**

Create `src/referrals/referrals.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [GymSettingsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
```

**Step 5: Register in AppModule**

In `src/app.module.ts`, add import:

```typescript
import { ReferralsModule } from './referrals/referrals.module';
```

Add `ReferralsModule` to the `imports` array.

**Step 6: Run lint and test**

Run: `yarn lint`
Run: `yarn test -- --testPathPattern=referrals`
Expected: No lint errors. Tests pass (will write tests in next task).

**Step 7: Commit**

```bash
git add src/referrals/ src/app.module.ts
git commit -m "feat(referral): add referrals module with controller, service, and DTOs"
```

---

### Task 8: Tests — Unit tests for referrals service

**Files:**
- Create: `src/referrals/referrals.service.spec.ts`

**Step 1: Write tests**

Create `src/referrals/referrals.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';

describe('ReferralsService', () => {
  let service: ReferralsService;
  let prisma: {
    user: { findUnique: jest.Mock };
    referral: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    memberSubscription: { findFirst: jest.Mock };
  };
  let gymSettings: { getCachedSettings: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      referral: {
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      memberSubscription: { findFirst: jest.fn() },
    };

    gymSettings = {
      getCachedSettings: jest.fn().mockResolvedValue({
        referralRewardDays: 7,
        maxReferralsPerCycle: 3,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GymSettingsService, useValue: gymSettings },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
  });

  describe('getMyCode', () => {
    it('should return the user referral code', async () => {
      prisma.user.findUnique.mockResolvedValue({ referralCode: 'ABC12345' });
      const result = await service.getMyCode('user-1');
      expect(result).toEqual({ referralCode: 'ABC12345' });
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMyCode('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyReferrals', () => {
    it('should return paginated referrals', async () => {
      prisma.referral.findMany.mockResolvedValue([
        {
          id: 'ref-1',
          referred: { firstName: 'Jane', lastName: 'Doe' },
          status: 'COMPLETED',
          rewardDays: 7,
          completedAt: new Date(),
          createdAt: new Date(),
        },
      ]);
      prisma.referral.count.mockResolvedValue(1);

      const result = await service.getMyReferrals('user-1', 1, 20);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].referredName).toBe('Jane Doe');
      expect(result.total).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return referral stats with cycle info', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.referral.count
        .mockResolvedValueOnce(5)   // totalReferrals
        .mockResolvedValueOnce(3)   // completedReferrals
        .mockResolvedValueOnce(2);  // referralsThisCycle
      prisma.referral.aggregate.mockResolvedValue({
        _sum: { rewardDays: 21 },
      });
      prisma.memberSubscription.findFirst.mockResolvedValue({
        startDate: new Date(),
      });

      const result = await service.getStats('user-1');
      expect(result.totalReferrals).toBe(5);
      expect(result.completedReferrals).toBe(3);
      expect(result.totalDaysEarned).toBe(21);
      expect(result.referralsThisCycle).toBe(2);
      expect(result.remainingThisCycle).toBe(1);
      expect(result.rewardDaysPerReferral).toBe(7);
    });

    it('should return 0 cycle referrals when no active subscription', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.referral.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      prisma.referral.aggregate.mockResolvedValue({
        _sum: { rewardDays: 7 },
      });
      prisma.memberSubscription.findFirst.mockResolvedValue(null);

      const result = await service.getStats('user-1');
      expect(result.referralsThisCycle).toBe(0);
      expect(result.remainingThisCycle).toBe(3);
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getStats('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

**Step 2: Run the tests**

Run: `yarn test -- --testPathPattern=referrals`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/referrals/referrals.service.spec.ts
git commit -m "test(referral): add unit tests for referrals service"
```

---

### Task 9: Seed data — Add referral codes and sample referrals

**Files:**
- Modify: `prisma/seed.ts`

**Step 1: Add referral codes to existing users**

After user creation in `prisma/seed.ts`, add referral codes to all users. Update the member creation loop (around line 47-52) to include `referralCode`:

```typescript
  for (let i = 1; i <= 10; i++) {
    const member = await prisma.user.create({
      data: {
        email: `member${i}@example.com`,
        password: hash,
        firstName: `Member`,
        lastName: `${i}`,
        role: 'MEMBER',
        phone: `+2547000000${i.toString().padStart(2, '0')}`,
        referralCode: `MEMBER0${i}`.slice(0, 8),
      },
    });
    members.push(member);
  }
```

Also add referral codes to admin/trainer users:

```typescript
  const superAdmin = await prisma.user.create({
    data: { ..., referralCode: 'SADMIN01' },
  });
  // Similar for admin1, admin2, trainer1, trainer2, trainer3
```

**Step 2: Add referral seed data and GymSettings referral fields**

After attendance/streak data, add:

```typescript
  // Referrals — Member 1 referred Members 4 and 5
  await prisma.user.update({
    where: { id: members[3].id },
    data: { referredById: members[0].id },
  });
  await prisma.referral.create({
    data: {
      referrerId: members[0].id,
      referredId: members[3].id,
      status: 'COMPLETED',
      rewardDays: 7,
      completedAt: daysAgo(2),
    },
  });

  await prisma.user.update({
    where: { id: members[4].id },
    data: { referredById: members[0].id },
  });
  await prisma.referral.create({
    data: {
      referrerId: members[0].id,
      referredId: members[4].id,
      status: 'COMPLETED',
      rewardDays: 7,
      completedAt: daysAgo(1),
    },
  });

  // Member 2 referred Member 6 (pending — hasn't paid yet)
  await prisma.user.update({
    where: { id: members[5].id },
    data: { referredById: members[1].id },
  });
  await prisma.referral.create({
    data: {
      referrerId: members[1].id,
      referredId: members[5].id,
      status: 'PENDING',
    },
  });
```

Update GymSettings seed (around line 295) to include referral fields:

```typescript
  await prisma.gymSettings.create({
    data: {
      id: 'singleton',
      timezone: 'Africa/Nairobi',
      referralRewardDays: 7,
      maxReferralsPerCycle: 3,
      offPeakWindows: {
        create: [
          { startTime: '06:00', endTime: '10:00' },
          { startTime: '14:00', endTime: '17:00' },
        ],
      },
    },
  });
```

**Step 3: Verify seed runs**

Run: `npx prisma db seed`
Expected: Seed completes successfully.

**Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(referral): add referral seed data with codes and sample referrals"
```

---

### Task 10: Verification — Full test suite, lint, and manual check

**Step 1: Run full test suite**

Run: `yarn test`
Expected: All tests pass.

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 3: Run dev server and verify Swagger**

Run: `yarn start:dev`

Verify in Swagger (`/api/docs`):
- `GET /api/v1/referrals/my-code` appears under Referrals tag
- `GET /api/v1/referrals/my-referrals` appears
- `GET /api/v1/referrals/stats` appears
- `POST /api/v1/auth/register` shows optional `referralCode` field
- `PUT /api/v1/gym-settings` shows `referralRewardDays` and `maxReferralsPerCycle`

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(referral): address lint and test issues"
```
