# Gym Management MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a gym management platform with a NestJS API, Expo mobile app, and Next.js admin dashboard for the Kenyan market.

**Architecture:** Three separate projects — the API is the source of truth, admin and mobile are independent clients. Types are defined in each project as needed. This avoids monorepo complexity, especially Expo/Metro bundler issues.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, Expo (React Native), Next.js, Paystack, JWT

**Repos:**
- `gym-management` (this repo) — NestJS API + Prisma + PostgreSQL
- `gym-admin` (separate repo) — Next.js admin dashboard
- `gym-mobile` (separate repo) — Expo mobile app

---

## Phase 1: API — Database & Foundation

### Task 1: Set up Prisma and database schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/prisma/prisma.service.ts`
- Create: `src/prisma/prisma.module.ts`
- Create: `.env`
- Modify: `package.json` (add prisma deps)
- Modify: `src/app.module.ts`

**Step 1: Install Prisma**

```bash
yarn add prisma @prisma/client && npx prisma init
```

**Step 2: Write the full Prisma schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  SUPER_ADMIN
  ADMIN
  TRAINER
  MEMBER
}

enum UserStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}

enum SubscriptionStatus {
  ACTIVE
  EXPIRED
  CANCELLED
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
}

enum SalaryStatus {
  PENDING
  PAID
}

model User {
  id        String     @id @default(uuid())
  email     String     @unique
  password  String
  phone     String?
  firstName String
  lastName  String
  role      Role       @default(MEMBER)
  status    UserStatus @default(ACTIVE)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  subscriptionsOwned  MemberSubscription[] @relation("SubscriptionOwner")
  subscriptionMembers SubscriptionMember[]
  attendances         Attendance[]
  streak              Streak?
  trainerProfile      TrainerProfile?
  trainerAssignmentsAsMember TrainerAssignment[] @relation("MemberAssignments")
  documentSignatures  DocumentSignature[]
  salaryRecords       StaffSalaryRecord[]
}

model SubscriptionPlan {
  id           String   @id @default(uuid())
  name         String
  price        Float
  currency     String   @default("KES")
  durationDays Int
  description  String?
  maxMembers   Int      @default(1)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  subscriptions MemberSubscription[]
}

model MemberSubscription {
  id                String             @id @default(uuid())
  primaryMemberId   String
  planId            String
  startDate         DateTime
  endDate           DateTime
  status            SubscriptionStatus @default(ACTIVE)
  paystackReference String?
  paymentStatus     PaymentStatus      @default(PENDING)
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  primaryMember User               @relation("SubscriptionOwner", fields: [primaryMemberId], references: [id])
  plan          SubscriptionPlan   @relation(fields: [planId], references: [id])
  members       SubscriptionMember[]
}

model SubscriptionMember {
  id             String @id @default(uuid())
  subscriptionId String
  memberId       String

  subscription MemberSubscription @relation(fields: [subscriptionId], references: [id])
  member       User               @relation(fields: [memberId], references: [id])

  @@unique([subscriptionId, memberId])
}

model Attendance {
  id          String   @id @default(uuid())
  memberId    String
  checkInDate DateTime @db.Date
  checkInTime DateTime @default(now())

  member User @relation(fields: [memberId], references: [id])

  @@unique([memberId, checkInDate])
}

model Streak {
  id              String    @id @default(uuid())
  memberId        String    @unique
  currentStreak   Int       @default(0)
  longestStreak   Int       @default(0)
  lastCheckInDate DateTime? @db.Date

  member User @relation(fields: [memberId], references: [id])
}

model TrainerProfile {
  id             String @id @default(uuid())
  userId         String @unique
  specialization String?
  bio            String?
  availability   Json?

  user        User              @relation(fields: [userId], references: [id])
  schedules   TrainerSchedule[]
  assignments TrainerAssignment[]
}

model TrainerSchedule {
  id          String @id @default(uuid())
  trainerId   String
  title       String
  dayOfWeek   Int
  startTime   String
  endTime     String
  maxCapacity Int    @default(10)

  trainer TrainerProfile @relation(fields: [trainerId], references: [id])
}

model TrainerAssignment {
  id        String    @id @default(uuid())
  trainerId String
  memberId  String
  startDate DateTime
  endDate   DateTime?
  notes     String?

  trainer TrainerProfile @relation(fields: [trainerId], references: [id])
  member  User           @relation("MemberAssignments", fields: [memberId], references: [id])
}

model LegalDocument {
  id         String   @id @default(uuid())
  title      String
  content    String
  version    Int      @default(1)
  isRequired Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  signatures DocumentSignature[]
}

model DocumentSignature {
  id            String   @id @default(uuid())
  memberId      String
  documentId    String
  signatureData String
  signedAt      DateTime @default(now())
  ipAddress     String?

  member   User          @relation(fields: [memberId], references: [id])
  document LegalDocument @relation(fields: [documentId], references: [id])

  @@unique([memberId, documentId])
}

model StaffSalaryRecord {
  id        String       @id @default(uuid())
  staffId   String
  month     Int
  year      Int
  amount    Float
  currency  String       @default("KES")
  status    SalaryStatus @default(PENDING)
  paidAt    DateTime?
  notes     String?
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  staff User @relation(fields: [staffId], references: [id])

  @@unique([staffId, month, year])
}

model GymQrCode {
  id        String    @id @default(uuid())
  code      String    @unique
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  expiresAt DateTime?
}
```

**Step 3: Create Prisma service and module**

`src/prisma/prisma.service.ts`:
```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

`src/prisma/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**Step 4: Set up .env**

`.env`:
```
DATABASE_URL="postgresql://user:password@localhost:5432/gym_management?schema=public"
JWT_SECRET="your-jwt-secret-change-in-production"
JWT_REFRESH_SECRET="your-refresh-secret-change-in-production"
PAYSTACK_SECRET_KEY="your-paystack-secret-key"
```

**Step 5: Add PrismaModule to AppModule**

`src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
})
export class AppModule {}
```

**Step 6: Run migration**

```bash
npx prisma migrate dev --name init
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema with all entities and PrismaModule"
```

---

## Phase 2: API — Authentication & Authorization

### Task 2: Auth module — register and login

**Files:**
- Create: `src/auth/auth.module.ts`
- Create: `src/auth/auth.service.ts`
- Create: `src/auth/auth.controller.ts`
- Create: `src/auth/dto/register.dto.ts`
- Create: `src/auth/dto/login.dto.ts`
- Create: `src/auth/auth.service.spec.ts`
- Modify: `src/app.module.ts`

**Step 1: Install dependencies**

```bash
yarn add @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt class-validator class-transformer && yarn add -D @types/passport-jwt @types/bcrypt
```

**Step 2: Write DTOs**

`src/auth/dto/register.dto.ts`:
```typescript
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
```

`src/auth/dto/login.dto.ts`:
```typescript
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
```

**Step 3: Write auth service test**

`src/auth/auth.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create a new user and return tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: '1', email: 'test@test.com', firstName: 'Test', lastName: 'User', role: 'MEMBER',
      });

      const result = await service.register({
        email: 'test@test.com', password: 'password123', firstName: 'Test', lastName: 'User',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw ConflictException if email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1' });

      await expect(
        service.register({ email: 'test@test.com', password: 'password123', firstName: 'Test', lastName: 'User' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1', email: 'test@test.com', password: hashedPassword, role: 'MEMBER',
      });

      const result = await service.login({ email: 'test@test.com', password: 'password123' });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1', email: 'test@test.com', password: hashedPassword,
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

**Step 4: Run test — expect fail**

```bash
yarn test auth.service.spec.ts
```

**Step 5: Implement AuthService**

`src/auth/auth.service.ts`:
```typescript
import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwtService: JwtService) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, password: hashedPassword, firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone },
    });

    return this.generateTokens(user.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    return this.generateTokens(user.id, user.email, user.role);
  }

  async refreshToken(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.generateTokens(user.id, user.email, user.role);
  }

  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d' }),
    ]);
    return { accessToken, refreshToken };
  }
}
```

**Step 6: Run test — expect pass**

```bash
yarn test auth.service.spec.ts
```

**Step 7: Implement AuthController**

`src/auth/auth.controller.ts`:
```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
```

**Step 8: Implement AuthModule and add to AppModule**

`src/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: add auth module with register, login, JWT tokens"
```

---

### Task 3: JWT guard and role-based authorization

**Files:**
- Create: `src/auth/guards/jwt-auth.guard.ts`
- Create: `src/auth/guards/roles.guard.ts`
- Create: `src/auth/decorators/roles.decorator.ts`
- Create: `src/auth/decorators/current-user.decorator.ts`
- Create: `src/auth/strategies/jwt.strategy.ts`

**Step 1: Create JWT strategy**

`src/auth/strategies/jwt.strategy.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
```

**Step 2: Create guards and decorators**

`src/auth/guards/jwt-auth.guard.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

`src/auth/decorators/roles.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

`src/auth/guards/roles.guard.ts`:
```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user.role);
  }
}
```

`src/auth/decorators/current-user.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add JWT guard, roles guard, and auth decorators"
```

---

## Phase 3: API — Core Modules

### Task 4: Users module (admin CRUD)

**Files:**
- Create: `src/users/users.module.ts`
- Create: `src/users/users.service.ts`
- Create: `src/users/users.controller.ts`
- Create: `src/users/dto/update-user.dto.ts`
- Create: `src/users/users.service.spec.ts`

**Step 1: Write DTO**

`src/users/dto/update-user.dto.ts`:
```typescript
import { IsOptional, IsString, IsEnum } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED']) status?: string;
  @IsOptional() @IsEnum(['SUPER_ADMIN', 'ADMIN', 'TRAINER', 'MEMBER']) role?: string;
}
```

**Step 2: Write test**

`src/users/users.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: '1', email: 'test@test.com' }),
      update: jest.fn().mockResolvedValue({ id: '1', status: 'SUSPENDED' }),
      delete: jest.fn().mockResolvedValue({ id: '1' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  it('should return all users', async () => {
    const result = await service.findAll();
    expect(result).toEqual([]);
  });

  it('should return a user by id', async () => {
    const result = await service.findOne('1');
    expect(result).toHaveProperty('id', '1');
  });
});
```

**Step 3: Run test — expect fail**

```bash
yarn test users.service.spec.ts
```

**Step 4: Implement UsersService**

`src/users/users.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, status: true, createdAt: true },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, status: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    return this.prisma.user.update({ where: { id }, data: dto,
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, status: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.user.delete({ where: { id } });
  }
}
```

**Step 5: Implement UsersController (Admin+ only)**

`src/users/users.controller.ts`:
```typescript
import { Controller, Get, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get() findAll() { return this.usersService.findAll(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.usersService.findOne(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateUserDto) { return this.usersService.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.usersService.remove(id); }
}
```

**Step 6: Create UsersModule, add to AppModule**

`src/users/users.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

**Step 7: Run tests — expect pass**

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add users module with CRUD for admin management"
```

---

### Task 5: Subscription plans module

**Files:**
- Create: `src/subscription-plans/subscription-plans.module.ts`
- Create: `src/subscription-plans/subscription-plans.service.ts`
- Create: `src/subscription-plans/subscription-plans.controller.ts`
- Create: `src/subscription-plans/dto/create-plan.dto.ts`
- Create: `src/subscription-plans/dto/update-plan.dto.ts`

**Step 1: Write DTOs**

`src/subscription-plans/dto/create-plan.dto.ts`:
```typescript
import { IsString, IsNumber, IsOptional, IsInt, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() name: string;
  @IsNumber() @Min(0) price: number;
  @IsInt() @Min(1) durationDays: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) maxMembers?: number;
}
```

`src/subscription-plans/dto/update-plan.dto.ts`:
```typescript
import { IsString, IsNumber, IsOptional, IsInt, Min, IsBoolean } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsInt() @Min(1) durationDays?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) maxMembers?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

**Step 2: Implement service (standard CRUD)**

`src/subscription-plans/subscription-plans.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class SubscriptionPlansService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreatePlanDto) { return this.prisma.subscriptionPlan.create({ data: dto }); }
  findAll() { return this.prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } }); }
  findActive() { return this.prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { price: 'asc' } }); }

  async findOne(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findOne(id);
    return this.prisma.subscriptionPlan.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.subscriptionPlan.delete({ where: { id } });
  }
}
```

**Step 3: Implement controller — CRUD for admins, active plans for all authenticated users**

`src/subscription-plans/subscription-plans.controller.ts`:
```typescript
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('subscription-plans')
export class SubscriptionPlansController {
  constructor(private plansService: SubscriptionPlansService) {}

  @Post() @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() dto: CreatePlanDto) { return this.plansService.create(dto); }

  @Get() @UseGuards(JwtAuthGuard)
  findAll() { return this.plansService.findActive(); }

  @Get('all') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  findAllIncludingInactive() { return this.plansService.findAll(); }

  @Get(':id') @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) { return this.plansService.findOne(id); }

  @Patch(':id') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) { return this.plansService.update(id, dto); }

  @Delete(':id') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  remove(@Param('id') id: string) { return this.plansService.remove(id); }
}
```

**Step 4: Create module, add to AppModule**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add subscription plans module with CRUD"
```

---

### Task 6: Member subscriptions module with duo support

**Files:**
- Create: `src/subscriptions/subscriptions.module.ts`
- Create: `src/subscriptions/subscriptions.service.ts`
- Create: `src/subscriptions/subscriptions.controller.ts`
- Create: `src/subscriptions/dto/create-subscription.dto.ts`
- Create: `src/subscriptions/dto/add-duo-member.dto.ts`
- Create: `src/subscriptions/subscriptions.service.spec.ts`

**Step 1: Write DTOs**

`src/subscriptions/dto/create-subscription.dto.ts`:
```typescript
import { IsString } from 'class-validator';
export class CreateSubscriptionDto { @IsString() planId: string; }
```

`src/subscriptions/dto/add-duo-member.dto.ts`:
```typescript
import { IsEmail } from 'class-validator';
export class AddDuoMemberDto { @IsEmail() memberEmail: string; }
```

**Step 2: Write test**

`src/subscriptions/subscriptions.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  const mockPrisma = {
    subscriptionPlan: { findUnique: jest.fn() },
    memberSubscription: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    subscriptionMember: { create: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubscriptionsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<SubscriptionsService>(SubscriptionsService);
    jest.clearAllMocks();
  });

  it('should return true if member has active subscription', async () => {
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({
      subscription: { status: 'ACTIVE', endDate: new Date(Date.now() + 86400000) },
    });
    expect(await service.hasActiveSubscription('member-1')).toBe(true);
  });

  it('should return false if no active subscription', async () => {
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue(null);
    expect(await service.hasActiveSubscription('member-1')).toBe(false);
  });
});
```

**Step 3: Run test — expect fail**

**Step 4: Implement SubscriptionsService**

`src/subscriptions/subscriptions.service.ts`:
```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService) {}

  async create(memberId: string, dto: CreateSubscriptionDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
    if (!plan || !plan.isActive) throw new NotFoundException('Plan not found or inactive');

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    return this.prisma.memberSubscription.create({
      data: {
        primaryMemberId: memberId, planId: dto.planId, startDate, endDate,
        status: 'ACTIVE', paymentStatus: 'PENDING',
        members: { create: { memberId } },
      },
      include: { plan: true, members: true },
    });
  }

  async addDuoMember(subscriptionId: string, memberEmail: string, requesterId: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId }, include: { plan: true, members: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.primaryMemberId !== requesterId) throw new BadRequestException('Only the primary member can add duo members');
    if (subscription.members.length >= subscription.plan.maxMembers) throw new BadRequestException('Subscription member limit reached');

    const member = await this.prisma.user.findUnique({ where: { email: memberEmail } });
    if (!member) throw new NotFoundException('Member not found with that email');

    return this.prisma.subscriptionMember.create({ data: { subscriptionId, memberId: member.id } });
  }

  async hasActiveSubscription(memberId: string): Promise<boolean> {
    const active = await this.prisma.subscriptionMember.findFirst({
      where: { memberId, subscription: { status: 'ACTIVE', endDate: { gte: new Date() } } },
    });
    return !!active;
  }

  async findByMember(memberId: string) {
    return this.prisma.memberSubscription.findMany({
      where: { members: { some: { memberId } } },
      include: { plan: true, members: { include: { member: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll() {
    return this.prisma.memberSubscription.findMany({
      include: { plan: true, primaryMember: true, members: { include: { member: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(subscriptionId: string, requesterId: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.primaryMemberId !== requesterId) throw new BadRequestException('Only the primary member can cancel');
    return this.prisma.memberSubscription.update({ where: { id: subscriptionId }, data: { status: 'CANCELLED' } });
  }
}
```

**Step 5: Implement controller**

`src/subscriptions/subscriptions.controller.ts`:
```typescript
import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { AddDuoMemberDto } from './dto/add-duo-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Post()
  create(@CurrentUser('id') memberId: string, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(memberId, dto);
  }

  @Post(':id/duo')
  addDuoMember(@Param('id') id: string, @Body() dto: AddDuoMemberDto, @CurrentUser('id') requesterId: string) {
    return this.subscriptionsService.addDuoMember(id, dto.memberEmail, requesterId);
  }

  @Get('my')
  findMine(@CurrentUser('id') memberId: string) {
    return this.subscriptionsService.findByMember(memberId);
  }

  @Get()
  @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  findAll() { return this.subscriptionsService.findAll(); }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('id') requesterId: string) {
    return this.subscriptionsService.cancel(id, requesterId);
  }
}
```

**Step 6: Create module, add to AppModule**

**Step 7: Run tests — expect pass**

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add subscriptions module with duo plan support"
```

---

### Task 7: Payments module (Paystack integration)

**Files:**
- Create: `src/payments/payments.module.ts`
- Create: `src/payments/payments.service.ts`
- Create: `src/payments/payments.controller.ts`

**Step 1: Install axios**

```bash
yarn add axios
```

**Step 2: Implement PaymentsService**

`src/payments/payments.service.ts`:
```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private paystackBaseUrl = 'https://api.paystack.co';

  constructor(private prisma: PrismaService) {}

  async initializePayment(subscriptionId: string, email: string) {
    const subscription = await this.prisma.memberSubscription.findUnique({
      where: { id: subscriptionId }, include: { plan: true },
    });
    if (!subscription) throw new BadRequestException('Subscription not found');

    const response = await axios.post(
      `${this.paystackBaseUrl}/transaction/initialize`,
      {
        email, amount: subscription.plan.price * 100, currency: 'KES',
        reference: `gym_${subscriptionId}_${Date.now()}`,
        metadata: { subscriptionId },
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } },
    );
    return response.data.data;
  }

  async handleWebhook(body: any, signature: string) {
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(body)).digest('hex');
    if (hash !== signature) throw new BadRequestException('Invalid signature');

    if (body.event === 'charge.success') {
      const { reference, metadata } = body.data;
      if (metadata?.subscriptionId) {
        await this.prisma.memberSubscription.update({
          where: { id: metadata.subscriptionId },
          data: { paymentStatus: 'PAID', paystackReference: reference, status: 'ACTIVE' },
        });
      }
    }
    return { received: true };
  }

  async getPaymentHistory(memberId: string) {
    return this.prisma.memberSubscription.findMany({
      where: { primaryMemberId: memberId, paymentStatus: 'PAID' },
      include: { plan: true }, orderBy: { createdAt: 'desc' },
    });
  }
}
```

**Step 3: Implement controller**

`src/payments/payments.controller.ts`:
```typescript
import { Controller, Post, Get, Param, Headers, Body, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('initialize/:subscriptionId') @UseGuards(JwtAuthGuard)
  initialize(@Param('subscriptionId') subscriptionId: string, @CurrentUser('email') email: string) {
    return this.paymentsService.initializePayment(subscriptionId, email);
  }

  @Post('webhook')
  webhook(@Body() body: any, @Headers('x-paystack-signature') signature: string) {
    return this.paymentsService.handleWebhook(body, signature);
  }

  @Get('history') @UseGuards(JwtAuthGuard)
  history(@CurrentUser('id') userId: string) { return this.paymentsService.getPaymentHistory(userId); }
}
```

**Step 4: Create module, add to AppModule**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add payments module with Paystack integration and webhook"
```

---

### Task 8: Attendance module with QR check-in and streaks

**Files:**
- Create: `src/attendance/attendance.module.ts`
- Create: `src/attendance/attendance.service.ts`
- Create: `src/attendance/attendance.controller.ts`
- Create: `src/attendance/dto/check-in.dto.ts`
- Create: `src/attendance/attendance.service.spec.ts`

**Step 1: Write DTO**

`src/attendance/dto/check-in.dto.ts`:
```typescript
import { IsString } from 'class-validator';
export class CheckInDto { @IsString() qrCode: string; }
```

**Step 2: Write test**

`src/attendance/attendance.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('AttendanceService', () => {
  let service: AttendanceService;

  const mockPrisma = {
    gymQrCode: { findFirst: jest.fn() },
    subscriptionMember: { findFirst: jest.fn() },
    attendance: { findUnique: jest.fn(), create: jest.fn() },
    streak: { upsert: jest.fn(), findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttendanceService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<AttendanceService>(AttendanceService);
    jest.clearAllMocks();
  });

  it('should reject invalid QR code', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue(null);
    await expect(service.checkIn('member-1', { qrCode: 'invalid' })).rejects.toThrow(BadRequestException);
  });

  it('should reject member without active subscription', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({ id: '1', code: 'valid' });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue(null);
    await expect(service.checkIn('member-1', { qrCode: 'valid' })).rejects.toThrow(ForbiddenException);
  });
});
```

**Step 3: Run test — expect fail**

**Step 4: Implement AttendanceService**

`src/attendance/attendance.service.ts`:
```typescript
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async checkIn(memberId: string, dto: CheckInDto) {
    const qr = await this.prisma.gymQrCode.findFirst({
      where: { code: dto.qrCode, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
    });
    if (!qr) throw new BadRequestException('Invalid or expired QR code');

    const activeMembership = await this.prisma.subscriptionMember.findFirst({
      where: { memberId, subscription: { status: 'ACTIVE', endDate: { gte: new Date() } } },
    });
    if (!activeMembership) throw new ForbiddenException('No active subscription');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.attendance.findUnique({
      where: { memberId_checkInDate: { memberId, checkInDate: today } },
    });

    if (existing) {
      const streak = await this.prisma.streak.findUnique({ where: { memberId } });
      return { alreadyCheckedIn: true, message: 'Already checked in today', streak: streak?.currentStreak ?? 0 };
    }

    await this.prisma.attendance.create({ data: { memberId, checkInDate: today } });
    const streak = await this.updateStreak(memberId, today);
    return { alreadyCheckedIn: false, message: 'Check-in successful', streak: streak.currentStreak, longestStreak: streak.longestStreak };
  }

  private async updateStreak(memberId: string, today: Date) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const existingStreak = await this.prisma.streak.findUnique({ where: { memberId } });
    let currentStreak = 1;
    let longestStreak = 1;

    if (existingStreak) {
      const lastDate = existingStreak.lastCheckInDate;
      if (lastDate && lastDate.getTime() === yesterday.getTime()) {
        currentStreak = existingStreak.currentStreak + 1;
      }
      longestStreak = Math.max(currentStreak, existingStreak.longestStreak);
    }

    return this.prisma.streak.upsert({
      where: { memberId },
      create: { memberId, currentStreak, longestStreak, lastCheckInDate: today },
      update: { currentStreak, longestStreak, lastCheckInDate: today },
    });
  }

  async getHistory(memberId: string) {
    return this.prisma.attendance.findMany({ where: { memberId }, orderBy: { checkInDate: 'desc' }, take: 90 });
  }

  async getStreak(memberId: string) {
    return this.prisma.streak.findUnique({ where: { memberId } });
  }

  async getLeaderboard() {
    return this.prisma.streak.findMany({
      orderBy: { currentStreak: 'desc' }, take: 50,
      include: { member: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async getTodayAttendance() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.prisma.attendance.findMany({
      where: { checkInDate: today },
      include: { member: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }
}
```

**Step 5: Implement controller**

`src/attendance/attendance.controller.ts`:
```typescript
import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CheckInDto } from './dto/check-in.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Post('check-in')
  checkIn(@CurrentUser('id') memberId: string, @Body() dto: CheckInDto) { return this.attendanceService.checkIn(memberId, dto); }

  @Get('history')
  history(@CurrentUser('id') memberId: string) { return this.attendanceService.getHistory(memberId); }

  @Get('streak')
  streak(@CurrentUser('id') memberId: string) { return this.attendanceService.getStreak(memberId); }

  @Get('leaderboard')
  leaderboard() { return this.attendanceService.getLeaderboard(); }

  @Get('today') @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  today() { return this.attendanceService.getTodayAttendance(); }
}
```

**Step 6: Create module, add to AppModule**

**Step 7: Run tests — expect pass**

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add attendance module with QR check-in, streaks, and leaderboard"
```

---

### Task 9: QR code management module

**Files:**
- Create: `src/qr/qr.module.ts`
- Create: `src/qr/qr.service.ts`
- Create: `src/qr/qr.controller.ts`

**Step 1: Implement QR service**

`src/qr/qr.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class QrService {
  constructor(private prisma: PrismaService) {}

  async generateCode() {
    await this.prisma.gymQrCode.updateMany({ where: { isActive: true }, data: { isActive: false } });
    const code = crypto.randomBytes(32).toString('hex');
    return this.prisma.gymQrCode.create({ data: { code, isActive: true } });
  }

  async getActiveCode() {
    return this.prisma.gymQrCode.findFirst({ where: { isActive: true } });
  }
}
```

**Step 2: Implement controller (Admin only)**

`src/qr/qr.controller.ts`:
```typescript
import { Controller, Post, Get, UseGuards } from '@nestjs/common';
import { QrService } from './qr.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('qr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class QrController {
  constructor(private qrService: QrService) {}

  @Post('generate') generate() { return this.qrService.generateCode(); }
  @Get('active') getActive() { return this.qrService.getActiveCode(); }
}
```

**Step 3: Create module, add to AppModule**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add QR code management module"
```

---

### Task 10: Trainers module

**Files:**
- Create: `src/trainers/trainers.module.ts`
- Create: `src/trainers/trainers.service.ts`
- Create: `src/trainers/trainers.controller.ts`
- Create: `src/trainers/dto/create-trainer-profile.dto.ts`
- Create: `src/trainers/dto/create-schedule.dto.ts`
- Create: `src/trainers/dto/assign-member.dto.ts`

**Step 1: Write DTOs**

`src/trainers/dto/create-trainer-profile.dto.ts`:
```typescript
import { IsString, IsOptional } from 'class-validator';

export class CreateTrainerProfileDto {
  @IsString() userId: string;
  @IsOptional() @IsString() specialization?: string;
  @IsOptional() @IsString() bio?: string;
  @IsOptional() availability?: any;
}
```

`src/trainers/dto/create-schedule.dto.ts`:
```typescript
import { IsString, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreateScheduleDto {
  @IsString() title: string;
  @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  @IsString() startTime: string;
  @IsString() endTime: string;
  @IsOptional() @IsInt() @Min(1) maxCapacity?: number;
}
```

`src/trainers/dto/assign-member.dto.ts`:
```typescript
import { IsString, IsOptional, IsDateString } from 'class-validator';

export class AssignMemberDto {
  @IsString() trainerId: string;
  @IsString() memberId: string;
  @IsDateString() startDate: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() notes?: string;
}
```

**Step 2: Implement TrainersService**

`src/trainers/trainers.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrainerProfileDto } from './dto/create-trainer-profile.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { AssignMemberDto } from './dto/assign-member.dto';

@Injectable()
export class TrainersService {
  constructor(private prisma: PrismaService) {}

  createProfile(dto: CreateTrainerProfileDto) {
    return this.prisma.trainerProfile.create({
      data: dto,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  findAll() {
    return this.prisma.trainerProfile.findMany({
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } }, schedules: true },
    });
  }

  async findOne(id: string) {
    const profile = await this.prisma.trainerProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        schedules: true,
        assignments: { include: { member: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
    if (!profile) throw new NotFoundException('Trainer not found');
    return profile;
  }

  addSchedule(trainerId: string, dto: CreateScheduleDto) {
    return this.prisma.trainerSchedule.create({ data: { trainerId, ...dto } });
  }

  getSchedules(trainerId: string) {
    return this.prisma.trainerSchedule.findMany({ where: { trainerId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] });
  }

  assignMember(dto: AssignMemberDto) {
    return this.prisma.trainerAssignment.create({
      data: { trainerId: dto.trainerId, memberId: dto.memberId, startDate: new Date(dto.startDate), endDate: dto.endDate ? new Date(dto.endDate) : null, notes: dto.notes },
    });
  }

  getMemberTrainer(memberId: string) {
    return this.prisma.trainerAssignment.findFirst({
      where: { memberId, endDate: null },
      include: { trainer: { include: { user: { select: { id: true, firstName: true, lastName: true } }, schedules: true } } },
    });
  }
}
```

**Step 3: Implement controller**

`src/trainers/trainers.controller.ts`:
```typescript
import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { TrainersService } from './trainers.service';
import { CreateTrainerProfileDto } from './dto/create-trainer-profile.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('trainers')
@UseGuards(JwtAuthGuard)
export class TrainersController {
  constructor(private trainersService: TrainersService) {}

  @Post() @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  createProfile(@Body() dto: CreateTrainerProfileDto) { return this.trainersService.createProfile(dto); }

  @Get() findAll() { return this.trainersService.findAll(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.trainersService.findOne(id); }

  @Post(':id/schedules') @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  addSchedule(@Param('id') trainerId: string, @Body() dto: CreateScheduleDto) { return this.trainersService.addSchedule(trainerId, dto); }

  @Get(':id/schedules')
  getSchedules(@Param('id') trainerId: string) { return this.trainersService.getSchedules(trainerId); }

  @Post('assign') @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  assignMember(@Body() dto: AssignMemberDto) { return this.trainersService.assignMember(dto); }

  @Get('my/trainer')
  getMyTrainer(@CurrentUser('id') memberId: string) { return this.trainersService.getMemberTrainer(memberId); }
}
```

**Step 4: Create module, add to AppModule**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add trainers module with profiles, schedules, and assignments"
```

---

### Task 11: Legal documents module

**Files:**
- Create: `src/legal/legal.module.ts`
- Create: `src/legal/legal.service.ts`
- Create: `src/legal/legal.controller.ts`
- Create: `src/legal/dto/create-document.dto.ts`
- Create: `src/legal/dto/sign-document.dto.ts`

**Step 1: Write DTOs**

`src/legal/dto/create-document.dto.ts`:
```typescript
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateDocumentDto {
  @IsString() title: string;
  @IsString() content: string;
  @IsOptional() @IsBoolean() isRequired?: boolean;
}
```

`src/legal/dto/sign-document.dto.ts`:
```typescript
import { IsString } from 'class-validator';

export class SignDocumentDto {
  @IsString() documentId: string;
  @IsString() signatureData: string;
}
```

**Step 2: Implement LegalService**

`src/legal/legal.service.ts`:
```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';

@Injectable()
export class LegalService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateDocumentDto) { return this.prisma.legalDocument.create({ data: dto }); }
  findAll() { return this.prisma.legalDocument.findMany({ orderBy: { createdAt: 'desc' } }); }

  async findOne(id: string) {
    const doc = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async sign(memberId: string, dto: SignDocumentDto, ipAddress?: string) {
    await this.findOne(dto.documentId);
    const existing = await this.prisma.documentSignature.findUnique({
      where: { memberId_documentId: { memberId, documentId: dto.documentId } },
    });
    if (existing) throw new BadRequestException('Document already signed');

    return this.prisma.documentSignature.create({
      data: { memberId, documentId: dto.documentId, signatureData: dto.signatureData, ipAddress },
    });
  }

  async getUnsignedDocuments(memberId: string) {
    const required = await this.prisma.legalDocument.findMany({ where: { isRequired: true } });
    const signed = await this.prisma.documentSignature.findMany({ where: { memberId }, select: { documentId: true } });
    const signedIds = new Set(signed.map((s) => s.documentId));
    return required.filter((doc) => !signedIds.has(doc.id));
  }

  async getSigningStatus(documentId: string) {
    return this.prisma.documentSignature.findMany({
      where: { documentId },
      include: { member: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }
}
```

**Step 3: Implement controller**

`src/legal/legal.controller.ts`:
```typescript
import { Controller, Get, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { LegalService } from './legal.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SignDocumentDto } from './dto/sign-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Request } from 'express';

@Controller('legal')
@UseGuards(JwtAuthGuard)
export class LegalController {
  constructor(private legalService: LegalService) {}

  @Post() @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() dto: CreateDocumentDto) { return this.legalService.create(dto); }

  @Get() findAll() { return this.legalService.findAll(); }

  @Get('unsigned')
  getUnsigned(@CurrentUser('id') memberId: string) { return this.legalService.getUnsignedDocuments(memberId); }

  @Post('sign')
  sign(@CurrentUser('id') memberId: string, @Body() dto: SignDocumentDto, @Req() req: Request) {
    return this.legalService.sign(memberId, dto, req.ip);
  }

  @Get(':id/signatures') @UseGuards(RolesGuard) @Roles('ADMIN', 'SUPER_ADMIN')
  getSigningStatus(@Param('id') documentId: string) { return this.legalService.getSigningStatus(documentId); }
}
```

**Step 4: Create module, add to AppModule**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add legal documents module with digital signatures"
```

---

### Task 12: Staff salary module (Super Admin only)

**Files:**
- Create: `src/salary/salary.module.ts`
- Create: `src/salary/salary.service.ts`
- Create: `src/salary/salary.controller.ts`
- Create: `src/salary/dto/create-salary-record.dto.ts`

**Step 1: Write DTO**

`src/salary/dto/create-salary-record.dto.ts`:
```typescript
import { IsString, IsNumber, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreateSalaryRecordDto {
  @IsString() staffId: string;
  @IsInt() @Min(1) @Max(12) month: number;
  @IsInt() year: number;
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() notes?: string;
}
```

**Step 2: Implement SalaryService**

`src/salary/salary.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';

@Injectable()
export class SalaryService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateSalaryRecordDto) { return this.prisma.staffSalaryRecord.create({ data: dto }); }

  findAll(filters?: { month?: number; year?: number }) {
    return this.prisma.staffSalaryRecord.findMany({
      where: filters,
      include: { staff: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  findByStaff(staffId: string) {
    return this.prisma.staffSalaryRecord.findMany({ where: { staffId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  async markAsPaid(id: string) {
    const record = await this.prisma.staffSalaryRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Salary record not found');
    return this.prisma.staffSalaryRecord.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
  }

  async remove(id: string) {
    const record = await this.prisma.staffSalaryRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Salary record not found');
    return this.prisma.staffSalaryRecord.delete({ where: { id } });
  }
}
```

**Step 3: Implement controller — all Super Admin only**

`src/salary/salary.controller.ts`:
```typescript
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('salary')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  @Post() create(@Body() dto: CreateSalaryRecordDto) { return this.salaryService.create(dto); }

  @Get() findAll(@Query('month') month?: string, @Query('year') year?: string) {
    return this.salaryService.findAll({ month: month ? parseInt(month) : undefined, year: year ? parseInt(year) : undefined });
  }

  @Get('staff/:staffId') findByStaff(@Param('staffId') staffId: string) { return this.salaryService.findByStaff(staffId); }
  @Patch(':id/pay') markAsPaid(@Param('id') id: string) { return this.salaryService.markAsPaid(id); }
  @Delete(':id') remove(@Param('id') id: string) { return this.salaryService.remove(id); }
}
```

**Step 4: Create module, add to AppModule**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add salary module for super admin payroll tracking"
```

---

### Task 13: API configuration — validation, CORS, global prefix, seed

**Files:**
- Modify: `src/main.ts`
- Create: `prisma/seed.ts`

**Step 1: Update main.ts**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: [process.env.ADMIN_URL || 'http://localhost:3001'], credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
```

**Step 2: Write seed script**

`prisma/seed.ts` — generate:
- 1 Super Admin, 2 Admins, 3 Trainers with profiles/schedules, 10 Members
- 3 Plans: Monthly Solo (KES 3000, 30 days, max 1), Monthly Duo (KES 5000, 30 days, max 2), Annual Solo (KES 30000, 365 days, max 1)
- A few active subscriptions including one duo
- Some attendance records and streaks
- 1 Legal document (gym waiver)
- An active QR code

Add to `package.json`:
```json
"prisma": { "seed": "ts-node prisma/seed.ts" }
```

Run: `npx prisma db seed`

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: configure API with CORS, validation, seed data"
```

---

## Phase 4: Admin Dashboard (separate project — gym-admin)

### Task 14: Initialize Next.js admin project

**In a separate directory (e.g., `~/Documents/js/gym-admin`):**

```bash
npx create-next-app@latest gym-admin --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

**Step 1: Install dependencies**

```bash
cd gym-admin && yarn add axios
```

**Step 2: Create API client** — `src/lib/api.ts` (axios with JWT interceptor, baseURL from `NEXT_PUBLIC_API_URL`)

**Step 3: Create auth context** — `src/lib/auth.tsx` (login, logout, JWT decode, localStorage)

**Step 4: Create sidebar** — `src/components/sidebar.tsx` (role-filtered nav items)

**Step 5: Create login page** — `src/app/login/page.tsx`

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: initialize admin dashboard with auth and layout"
```

---

### Task 15: Admin dashboard pages

Build each page as standard CRUD table/form using the API:

- `src/app/page.tsx` — Dashboard (active members, revenue, today's attendance)
- `src/app/members/page.tsx` — Members table with search, edit, status toggle
- `src/app/subscriptions/page.tsx` — Plans CRUD + active subscriptions + duo linkages
- `src/app/attendance/page.tsx` — Today's check-ins, search by member
- `src/app/trainers/page.tsx` — Trainer roster, schedules, assignments
- `src/app/legal/page.tsx` — Document management, signing status
- `src/app/qr/page.tsx` — Generate/view QR code for gym entrance
- `src/app/payroll/page.tsx` — Salary records (Super Admin only, hidden for Admin)

**Commit after each page or group of related pages.**

---

## Phase 5: Mobile App (separate project — gym-mobile)

### Task 16: Initialize Expo project with navigation and auth

**In a separate directory (e.g., `~/Documents/js/gym-mobile`):**

```bash
npx create-expo-app@latest gym-mobile --template blank-typescript
```

**Step 1: Install dependencies**

```bash
cd gym-mobile && npx expo install expo-secure-store expo-camera @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context axios
```

**Step 2: Create API client** — `src/lib/api.ts` (axios with SecureStore token)

**Step 3: Create auth context** — `src/lib/auth.tsx` (SecureStore-based login/logout)

**Step 4: Create Login and Register screens**

**Step 5: Set up navigation** — auth stack vs main tab navigator

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: initialize mobile app with navigation and auth"
```

---

### Task 17: Mobile — Legal docs with digital signature

**Step 1: Install signature library**

```bash
npx expo install react-native-signature-canvas
```

**Step 2: Build LegalDocsScreen** — fetch unsigned docs, show content, signature canvas, submit base64, block main app until all signed

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add legal docs screen with digital signature"
```

---

### Task 18: Mobile — Home, subscription, and payment

**Step 1: Install Paystack**

```bash
npx expo install react-native-paystack-webview
```

**Step 2: Build HomeScreen** — subscription status, streak count, quick check-in button

**Step 3: Build SubscriptionScreen** — list plans, duo indicator, add duo member, subscribe button

**Step 4: Build PaymentScreen** — Paystack WebView, success callback updates subscription

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add home, subscription, and payment screens"
```

---

### Task 19: Mobile — QR scanner and attendance

**Step 1: Build QRScannerScreen** — expo-camera barcode scan, POST check-in, success/error display with streak

**Step 2: Build AttendanceHistoryScreen** — calendar view, streak display

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add QR scanner and attendance history screens"
```

---

### Task 20: Mobile — Leaderboard, trainer, and profile

**Step 1: Build LeaderboardScreen** — ranked list, highlight current user

**Step 2: Build TrainerScreen** — assigned trainer profile + schedule

**Step 3: Build ProfileScreen** — edit info, change password

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add leaderboard, trainer, and profile screens"
```

---

## Phase 6: Final Testing

### Task 21: End-to-end smoke test

**Step 1: Start all three apps**

```bash
# Terminal 1: API
cd gym-management && yarn start:dev

# Terminal 2: Admin
cd gym-admin && yarn dev

# Terminal 3: Mobile
cd gym-mobile && npx expo start
```

**Step 2: Test flows**

- Admin login → dashboard → create plan → view members
- Member register (mobile) → sign legal docs → subscribe → pay via Paystack
- QR check-in flow → verify streak updates → check leaderboard
- Duo plan: primary subscribes → adds duo member → duo member checks in
- Super Admin: view payroll → add salary record → mark as paid
- Admin cannot see payroll page

**Step 3: Fix any issues found**

**Step 4: Final commit in each repo**
