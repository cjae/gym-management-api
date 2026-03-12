# Admin Create User Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow ADMIN/SUPER_ADMIN to create users (MEMBER, TRAINER, ADMIN) with a temp password and welcome email.

**Architecture:** Add `POST /api/v1/users` to the existing UsersController. UsersService generates a 12-char random password, creates the user with `mustChangePassword: true`, and sends a welcome email with login credentials. Role hierarchy enforced: ADMIN creates MEMBER/TRAINER, SUPER_ADMIN creates MEMBER/TRAINER/ADMIN. License member limit checked for MEMBER role.

**Tech Stack:** NestJS, Prisma, bcrypt, crypto.randomBytes, Handlebars email templates, Mailgun

---

### Task 1: Create the CreateUserDto

**Files:**
- Create: `src/users/dto/create-user.dto.ts`

**Step 1: Create the DTO file**

```typescript
import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, Gender } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'jane@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Jane', description: 'First name' })
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'Last name' })
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({
    enum: ['MEMBER', 'TRAINER', 'ADMIN'],
    description: 'Role to assign. ADMIN can create MEMBER/TRAINER. SUPER_ADMIN can also create ADMIN.',
  })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({ example: '+254712345678', description: 'Phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'Gender',
    enum: ['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY'],
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: '2000-03-10',
    description: 'Birthday (ISO date string)',
  })
  @IsOptional()
  @IsDateString()
  birthday?: string;
}
```

**Step 2: Verify lint passes**

Run: `yarn lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/users/dto/create-user.dto.ts
git commit -m "feat(users): add CreateUserDto for admin user creation"
```

---

### Task 2: Add create method to UsersService

**Files:**
- Modify: `src/users/users.service.ts`

**Step 1: Write the failing test**

Add to `src/users/users.service.spec.ts`:

```typescript
// Add imports at the top
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';

// Update mockPrisma to add `create` mock
// In the mockPrisma object, add to user:
//   create: jest.fn().mockResolvedValue(mockUserFromDb),

// Add mock services
const mockEmailService = {
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
};

const mockLicensingService = {
  getMemberLimit: jest.fn().mockResolvedValue(null),
};

// Update the TestingModule providers to include:
//   { provide: EmailService, useValue: mockEmailService },
//   { provide: LicensingService, useValue: mockLicensingService },

// Add test suite
describe('create', () => {
  const createDto = {
    email: 'new@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    role: 'MEMBER' as const,
  };

  it('should create a user with hashed password and mustChangePassword=true', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    const result = await service.create(createDto, 'ADMIN');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          firstName: 'Jane',
          lastName: 'Smith',
          role: 'MEMBER',
          mustChangePassword: true,
        }),
      }),
    );
    expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith(
      'new@example.com',
      'Jane',
      expect.any(String), // temp password
    );
    expect(result).toBeDefined();
  });

  it('should throw ConflictException if email already exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockUserFromDb);
    await expect(service.create(createDto, 'ADMIN')).rejects.toThrow(
      ConflictException,
    );
  });

  it('should throw ForbiddenException if ADMIN tries to create ADMIN', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.create({ ...createDto, role: 'ADMIN' as const }, 'ADMIN'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should allow SUPER_ADMIN to create ADMIN', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await service.create({ ...createDto, role: 'ADMIN' as const }, 'SUPER_ADMIN');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'ADMIN' }),
      }),
    );
  });

  it('should throw ForbiddenException if SUPER_ADMIN tries to create SUPER_ADMIN', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.create({ ...createDto, role: 'SUPER_ADMIN' as const }, 'SUPER_ADMIN'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should enforce license member limit for MEMBER role', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockLicensingService.getMemberLimit.mockResolvedValueOnce(10);
    mockPrisma.user.count.mockResolvedValueOnce(10);
    await expect(service.create(createDto, 'ADMIN')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- --testPathPattern=users.service`
Expected: FAIL — `service.create is not a function`

**Step 3: Implement the create method in UsersService**

Add imports to `src/users/users.service.ts`:
```typescript
import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import {
  safeUserSelect,
  safeUserWithSubscriptionSelect,
} from '../common/constants/safe-user-select';
```

Add constructor dependencies:
```typescript
constructor(
  private prisma: PrismaService,
  private emailService: EmailService,
  private licensingService: LicensingService,
) {}
```

Add method:
```typescript
async create(dto: CreateUserDto, callerRole: string) {
  // Role hierarchy enforcement
  if (dto.role === 'SUPER_ADMIN') {
    throw new ForbiddenException('Cannot create SUPER_ADMIN users');
  }
  if (dto.role === 'ADMIN' && callerRole !== 'SUPER_ADMIN') {
    throw new ForbiddenException('Only SUPER_ADMIN can create ADMIN users');
  }

  // Check email uniqueness
  const existing = await this.prisma.user.findUnique({
    where: { email: dto.email },
  });
  if (existing && !existing.deletedAt) {
    throw new ConflictException('Email already registered');
  }

  // License member limit check
  if (dto.role === 'MEMBER') {
    const maxMembers = await this.licensingService.getMemberLimit();
    if (maxMembers !== null) {
      const currentCount = await this.prisma.user.count({
        where: { role: 'MEMBER', deletedAt: null },
      });
      if (currentCount >= maxMembers) {
        throw new ForbiddenException(
          'Member limit reached for your subscription tier.',
        );
      }
    }
  }

  // Generate temp password
  const tempPassword = randomBytes(9).toString('base64url').slice(0, 12);
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  const user = await this.prisma.user.create({
    data: {
      email: dto.email,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      role: dto.role,
      gender: dto.gender,
      birthday: dto.birthday ? new Date(dto.birthday) : undefined,
      mustChangePassword: true,
    },
    select: safeUserSelect,
  });

  // Send welcome email (fire-and-forget)
  this.emailService
    .sendWelcomeEmail(dto.email, dto.firstName, tempPassword)
    .catch(() => {});

  return user;
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=users.service`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "feat(users): add create method with temp password and role enforcement"
```

---

### Task 3: Add welcome email template and sendWelcomeEmail method

**Files:**
- Create: `src/email/templates/welcome.hbs`
- Modify: `src/email/email.service.ts`

**Step 1: Create the welcome email template**

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
      <h2 style="color: #333333; margin: 0 0 16px 0;">Welcome to the Gym!</h2>
      <p style="color: #555555; line-height: 1.6; margin: 0 0 8px 0;">Hi {{firstName}},</p>
      <p style="color: #555555; line-height: 1.6; margin: 0 0 24px 0;">An account has been created for you. Use the credentials below to log in:</p>

      <div style="background-color: #f8f8f8; border-radius: 8px; padding: 20px; margin: 0 0 24px 0;">
        <p style="color: #333333; margin: 0 0 8px 0;"><strong>Email:</strong> {{email}}</p>
        <p style="color: #333333; margin: 0;"><strong>Temporary Password:</strong> {{tempPassword}}</p>
      </div>

      <p style="color: #e74c3c; font-weight: 600; line-height: 1.6; margin: 0 0 24px 0;">Please change your password after your first login.</p>

      {{> button url=loginUrl text="Log In"}}
    </div>

    {{> footer}}
  </div>
</body>
</html>
```

**Step 2: Add sendWelcomeEmail to EmailService**

Add this method to `src/email/email.service.ts`:

```typescript
async sendWelcomeEmail(
  to: string,
  firstName: string,
  tempPassword: string,
): Promise<void> {
  await this.sendEmail(to, 'Welcome — Your Account is Ready', 'welcome', {
    firstName,
    email: to,
    tempPassword,
    loginUrl: this.adminUrl,
  });
}
```

**Step 3: Verify lint passes**

Run: `yarn lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/email/templates/welcome.hbs src/email/email.service.ts
git commit -m "feat(email): add welcome email template with login credentials"
```

---

### Task 4: Add POST endpoint to UsersController

**Files:**
- Modify: `src/users/users.controller.ts`

**Step 1: Add POST endpoint**

Add imports:
```typescript
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiConflictResponse } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
```

Add method to controller (before findAll):
```typescript
@Post()
@ApiCreatedResponse({ type: UserResponseDto, description: 'User created with temp password' })
@ApiConflictResponse({ description: 'Email already registered' })
create(@Body() dto: CreateUserDto, @CurrentUser('role') callerRole: string) {
  return this.usersService.create(dto, callerRole);
}
```

**Step 2: Verify lint passes**

Run: `yarn lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/users/users.controller.ts
git commit -m "feat(users): add POST /users endpoint for admin user creation"
```

---

### Task 5: Run full test suite and verify build

**Step 1: Run all tests**

Run: `yarn test`
Expected: All tests pass

**Step 2: Run build**

Run: `yarn build`
Expected: Compiles without errors

**Step 3: Update CLAUDE.md**

Add to the `subscriptions/` bullet or after it in the Modules section:
> Users module now supports admin-created users via `POST /users` (ADMIN/SUPER_ADMIN). Temp password generated, welcome email sent, `mustChangePassword` flag set.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with admin create user feature"
```
