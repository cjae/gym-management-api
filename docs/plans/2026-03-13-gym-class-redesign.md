# GymClass Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decouple schedules from trainers into independent GymClass entities with member self-enrollment and email notifications on schedule changes.

**Architecture:** New `gym-classes/` module with `GymClass` and `ClassEnrollment` Prisma models. Trainers are optionally assigned to classes. Members self-enroll. Email notifications fire on time changes and cancellations. Existing `TrainerSchedule` model is dropped; `TrainerAssignment` (1:1 personal training) stays unchanged.

**Tech Stack:** NestJS 11, Prisma 6, Jest + jest-mock-extended, Handlebars email templates, Mailgun

**Design doc:** `docs/plans/2026-03-13-gym-class-redesign-design.md`

---

### Task 1: Update Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Replace TrainerSchedule with GymClass and ClassEnrollment models**

In `prisma/schema.prisma`, remove the `TrainerSchedule` model (lines 213-223) and replace with:

```prisma
model GymClass {
  id          String   @id @default(uuid())
  title       String
  description String?
  dayOfWeek   Int
  startTime   String
  endTime     String
  maxCapacity Int      @default(20)
  trainerId   String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  trainer     TrainerProfile?   @relation(fields: [trainerId], references: [id])
  enrollments ClassEnrollment[]
}

model ClassEnrollment {
  id         String   @id @default(uuid())
  classId    String
  memberId   String
  enrolledAt DateTime @default(now())

  gymClass GymClass @relation(fields: [classId], references: [id])
  member   User     @relation(fields: [memberId], references: [id])

  @@unique([classId, memberId])
}
```

**Step 2: Update TrainerProfile relation**

Change the `schedules` relation in `TrainerProfile` (line 209):

```prisma
// Before:
schedules   TrainerSchedule[]

// After:
classes     GymClass[]
```

**Step 3: Add ClassEnrollment relation to User model**

Add to the `User` model relations (after line 120, near `bannerInteractions`):

```prisma
classEnrollments       ClassEnrollment[]
```

**Step 4: Generate migration and Prisma client**

Run:
```bash
npx prisma migrate dev --name replace-trainer-schedule-with-gym-class
npx prisma generate
```

Expected: Migration created, client regenerated. `TrainerSchedule` table dropped, `GymClass` and `ClassEnrollment` tables created.

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): replace TrainerSchedule with GymClass and ClassEnrollment"
```

---

### Task 2: Clean Up Trainers Module (Remove Schedule Endpoints)

**Files:**
- Modify: `src/trainers/trainers.controller.ts`
- Modify: `src/trainers/trainers.service.ts`
- Modify: `src/trainers/trainers.service.spec.ts`
- Delete: `src/trainers/dto/create-schedule.dto.ts`
- Delete: `src/trainers/dto/update-schedule.dto.ts`
- Delete: `src/trainers/dto/trainer-schedule-response.dto.ts`

**Step 1: Remove schedule methods from trainers.service.ts**

Remove these methods entirely:
- `addSchedule` (lines 94-105)
- `getAllSchedules` (lines 107-116)
- `updateSchedule` (lines 118-133)
- `deleteSchedule` (lines 135-139)
- `getSchedules` (lines 141-146)

Remove imports of `CreateScheduleDto` and `UpdateScheduleDto`.

In `findAll`, change `schedules: true` to `classes: true` in the include.

In `findOne` and `findByUserId`, change `schedules: true` to `classes: true` in the include.

In `getMemberTrainer`, change `schedules: true` to `classes: true` in the include.

**Step 2: Remove schedule endpoints from trainers.controller.ts**

Remove these endpoints:
- `GET /trainers/schedules` (getAllSchedules, lines 64-68)
- `POST /trainers/:id/schedules` (addSchedule, lines 95-101)
- `GET /trainers/:id/schedules` (getSchedules, lines 103-107)
- `PATCH /trainers/:id/schedules/:scheduleId` (updateSchedule, lines 109-120)
- `DELETE /trainers/:id/schedules/:scheduleId` (deleteSchedule, lines 122-132)

Remove unused imports: `CreateScheduleDto`, `UpdateScheduleDto`, `TrainerScheduleResponseDto`, `Delete`.

**Step 3: Remove schedule-related DTO files**

```bash
rm src/trainers/dto/create-schedule.dto.ts
rm src/trainers/dto/update-schedule.dto.ts
rm src/trainers/dto/trainer-schedule-response.dto.ts
```

**Step 4: Update trainers.service.spec.ts**

Remove the `mockSchedule` constant and these test blocks:
- `describe('addSchedule', ...)`
- `describe('getSchedules', ...)`

Update the `findAll` test to expect `classes` instead of `schedules` in the include.

**Step 5: Run tests to verify nothing is broken**

Run: `yarn test -- --testPathPattern=trainers`
Expected: All remaining trainer tests pass.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(trainers): remove schedule endpoints, replaced by gym-classes module"
```

---

### Task 3: Create GymClass DTOs

**Files:**
- Create: `src/gym-classes/dto/create-gym-class.dto.ts`
- Create: `src/gym-classes/dto/update-gym-class.dto.ts`
- Create: `src/gym-classes/dto/gym-class-response.dto.ts`

**Step 1: Create the DTOs directory**

```bash
mkdir -p src/gym-classes/dto
```

**Step 2: Create create-gym-class.dto.ts**

```typescript
import {
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUUID,
  MaxLength,
  Matches,
  Validate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEndTimeAfterStartTime,
} from './validators/end-time-after-start-time.validator';

export class CreateGymClassDto {
  @ApiProperty({ example: 'Morning HIIT' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'High-intensity interval training session' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 1, description: 'Day of week (0 = Sunday, 6 = Saturday)' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '06:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:MM 24-hour format',
  })
  startTime: string;

  @ApiProperty({ example: '07:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:MM 24-hour format',
  })
  @Validate(IsEndTimeAfterStartTime)
  endTime: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;

  @ApiPropertyOptional({ example: 'trainer-profile-uuid', description: 'Trainer profile ID to assign' })
  @IsOptional()
  @IsUUID()
  trainerId?: string;
}
```

**Step 3: Create the shared validator**

```bash
mkdir -p src/gym-classes/dto/validators
```

Create `src/gym-classes/dto/validators/end-time-after-start-time.validator.ts`:

```typescript
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isEndTimeAfterStartTime', async: false })
export class IsEndTimeAfterStartTime implements ValidatorConstraintInterface {
  validate(_value: string, args: ValidationArguments) {
    const obj = args.object as { startTime?: string; endTime?: string };
    if (!obj.startTime || !obj.endTime) return true;
    return obj.startTime < obj.endTime;
  }

  defaultMessage() {
    return 'endTime must be after startTime';
  }
}
```

**Step 4: Create update-gym-class.dto.ts**

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateGymClassDto } from './create-gym-class.dto';

export class UpdateGymClassDto extends PartialType(CreateGymClassDto) {}
```

**Step 5: Create gym-class-response.dto.ts**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GymClassResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  dayOfWeek: number;

  @ApiProperty()
  startTime: string;

  @ApiProperty()
  endTime: string;

  @ApiProperty()
  maxCapacity: number;

  @ApiPropertyOptional()
  trainerId?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedGymClassesResponseDto {
  @ApiProperty({ type: [GymClassResponseDto] })
  data: GymClassResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
```

**Step 6: Commit**

```bash
git add src/gym-classes/
git commit -m "feat(gym-classes): add DTOs for GymClass CRUD"
```

---

### Task 4: Create GymClasses Service with Tests (TDD)

**Files:**
- Create: `src/gym-classes/gym-classes.service.ts`
- Create: `src/gym-classes/gym-classes.service.spec.ts`

**Step 1: Write the test file**

Create `src/gym-classes/gym-classes.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { GymClassesService } from './gym-classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('GymClassesService', () => {
  let service: GymClassesService;
  let prisma: DeepMockProxy<PrismaClient>;
  let emailService: DeepMockProxy<EmailService>;

  const mockGymClass = {
    id: 'class-1',
    title: 'Morning HIIT',
    description: null,
    dayOfWeek: 1,
    startTime: '06:00',
    endTime: '07:00',
    maxCapacity: 20,
    trainerId: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEnrollment = {
    id: 'enroll-1',
    classId: 'class-1',
    memberId: 'member-1',
    enrolledAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GymClassesService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockDeep<EmailService>() },
      ],
    }).compile();

    service = module.get<GymClassesService>(GymClassesService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a gym class', async () => {
      prisma.gymClass.findFirst.mockResolvedValue(null);
      prisma.gymClass.create.mockResolvedValue(mockGymClass as any);

      const result = await service.create({
        title: 'Morning HIIT',
        dayOfWeek: 1,
        startTime: '06:00',
        endTime: '07:00',
      });

      expect(result).toEqual(mockGymClass);
      expect(prisma.gymClass.create).toHaveBeenCalled();
    });

    it('should throw ConflictException on time overlap', async () => {
      prisma.gymClass.findFirst.mockResolvedValue(mockGymClass as any);

      await expect(
        service.create({
          title: 'Another Class',
          dayOfWeek: 1,
          startTime: '06:30',
          endTime: '07:30',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated active gym classes', async () => {
      prisma.gymClass.findMany.mockResolvedValue([mockGymClass] as any);
      prisma.gymClass.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({
        data: [mockGymClass],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(prisma.gymClass.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a gym class by id', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);

      const result = await service.findOne('class-1');

      expect(result).toEqual(mockGymClass);
    });

    it('should throw NotFoundException when class not found', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a gym class', async () => {
      const updated = { ...mockGymClass, title: 'Evening HIIT' };
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.gymClass.findFirst.mockResolvedValue(null);
      prisma.gymClass.update.mockResolvedValue(updated as any);

      const result = await service.update('class-1', { title: 'Evening HIIT' });

      expect(result.title).toBe('Evening HIIT');
    });

    it('should send emails when time changes', async () => {
      const updated = { ...mockGymClass, startTime: '07:00', endTime: '08:00' };
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        enrollments: [
          { member: { email: 'a@b.com', firstName: 'John' } },
        ],
      } as any);
      prisma.gymClass.findFirst.mockResolvedValue(null);
      prisma.gymClass.update.mockResolvedValue(updated as any);

      await service.update('class-1', { startTime: '07:00', endTime: '08:00' });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Class Schedule Updated'),
        'class-updated',
        expect.any(Object),
      );
    });

    it('should throw ConflictException on time overlap with another class', async () => {
      const otherClass = { ...mockGymClass, id: 'class-2' };
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.gymClass.findFirst.mockResolvedValue(otherClass as any);

      await expect(
        service.update('class-1', { startTime: '06:00', endTime: '07:00' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft-delete and notify enrolled members', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        enrollments: [
          { member: { email: 'a@b.com', firstName: 'John' } },
        ],
      } as any);
      prisma.gymClass.update.mockResolvedValue({
        ...mockGymClass,
        isActive: false,
      } as any);

      const result = await service.remove('class-1');

      expect(result.isActive).toBe(false);
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Class Cancelled'),
        'class-cancelled',
        expect.any(Object),
      );
    });
  });

  describe('enroll', () => {
    it('should enroll a member in a class', async () => {
      prisma.gymClass.findUnique.mockResolvedValue(mockGymClass as any);
      prisma.classEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const result = await service.enroll('class-1', 'member-1');

      expect(result).toEqual(mockEnrollment);
    });

    it('should throw NotFoundException for inactive class', async () => {
      prisma.gymClass.findUnique.mockResolvedValue({
        ...mockGymClass,
        isActive: false,
      } as any);

      await expect(service.enroll('class-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('unenroll', () => {
    it('should remove enrollment', async () => {
      prisma.classEnrollment.deleteMany.mockResolvedValue({ count: 1 });

      await service.unenroll('class-1', 'member-1');

      expect(prisma.classEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { classId: 'class-1', memberId: 'member-1' },
      });
    });
  });

  describe('getEnrollments', () => {
    it('should return enrollments for a class', async () => {
      prisma.classEnrollment.findMany.mockResolvedValue([mockEnrollment] as any);

      const result = await service.getEnrollments('class-1');

      expect(result).toEqual([mockEnrollment]);
    });
  });

  describe('getMyClasses', () => {
    it('should return classes a member is enrolled in', async () => {
      prisma.classEnrollment.findMany.mockResolvedValue([
        { ...mockEnrollment, gymClass: mockGymClass },
      ] as any);

      const result = await service.getMyClasses('member-1');

      expect(result).toHaveLength(1);
    });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `yarn test -- --testPathPattern=gym-classes`
Expected: FAIL — `Cannot find module './gym-classes.service'`

**Step 3: Create the service implementation**

Create `src/gym-classes/gym-classes.service.ts`:

```typescript
import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateGymClassDto } from './dto/create-gym-class.dto';
import { UpdateGymClassDto } from './dto/update-gym-class.dto';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
};

@Injectable()
export class GymClassesService {
  private readonly logger = new Logger(GymClassesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async create(dto: CreateGymClassDto) {
    await this.checkTimeOverlap(dto.dayOfWeek, dto.startTime, dto.endTime);

    return this.prisma.gymClass.create({
      data: {
        title: dto.title,
        description: dto.description,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        maxCapacity: dto.maxCapacity ?? 20,
        trainerId: dto.trainerId,
      },
      include: {
        trainer: { include: { user: { select: safeUserSelect } } },
      },
    });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.gymClass.findMany({
        where: { isActive: true },
        include: {
          trainer: { include: { user: { select: safeUserSelect } } },
          _count: { select: { enrollments: true } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.gymClass.count({ where: { isActive: true } }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const gymClass = await this.prisma.gymClass.findUnique({
      where: { id },
      include: {
        trainer: { include: { user: { select: safeUserSelect } } },
        enrollments: {
          include: { member: { select: safeUserSelect } },
        },
      },
    });

    if (!gymClass) {
      throw new NotFoundException('Class not found');
    }

    return gymClass;
  }

  async update(id: string, dto: UpdateGymClassDto) {
    const existing = await this.prisma.gymClass.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Class not found');
    }

    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;

    if (
      dto.dayOfWeek !== undefined ||
      dto.startTime !== undefined ||
      dto.endTime !== undefined
    ) {
      await this.checkTimeOverlap(dayOfWeek, startTime, endTime, id);
    }

    const updated = await this.prisma.gymClass.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        maxCapacity: dto.maxCapacity,
        trainerId: dto.trainerId,
      },
      include: {
        trainer: { include: { user: { select: safeUserSelect } } },
      },
    });

    const timeChanged =
      existing.dayOfWeek !== updated.dayOfWeek ||
      existing.startTime !== updated.startTime ||
      existing.endTime !== updated.endTime;

    if (timeChanged && existing.enrollments.length > 0) {
      this.notifyTimeChange(existing, updated);
    }

    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.gymClass.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Class not found');
    }

    const result = await this.prisma.gymClass.update({
      where: { id },
      data: { isActive: false },
    });

    if (existing.enrollments.length > 0) {
      this.notifyCancellation(existing);
    }

    return result;
  }

  async enroll(classId: string, memberId: string) {
    const gymClass = await this.prisma.gymClass.findUnique({
      where: { id: classId },
    });

    if (!gymClass || !gymClass.isActive) {
      throw new NotFoundException('Class not found or is inactive');
    }

    return this.prisma.classEnrollment.create({
      data: { classId, memberId },
    });
  }

  async unenroll(classId: string, memberId: string) {
    await this.prisma.classEnrollment.deleteMany({
      where: { classId, memberId },
    });
  }

  async getEnrollments(classId: string) {
    return this.prisma.classEnrollment.findMany({
      where: { classId },
      include: { member: { select: safeUserSelect } },
    });
  }

  async getMyClasses(memberId: string) {
    return this.prisma.classEnrollment.findMany({
      where: {
        memberId,
        gymClass: { isActive: true },
      },
      include: {
        gymClass: {
          include: {
            trainer: { include: { user: { select: safeUserSelect } } },
          },
        },
      },
      orderBy: { gymClass: { dayOfWeek: 'asc' } },
    });
  }

  private async checkTimeOverlap(
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ) {
    const overlap = await this.prisma.gymClass.findFirst({
      where: {
        dayOfWeek,
        isActive: true,
        startTime: { lt: endTime },
        endTime: { gt: startTime },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (overlap) {
      throw new ConflictException(
        `Time overlaps with existing class "${overlap.title}" (${overlap.startTime}-${overlap.endTime})`,
      );
    }
  }

  private notifyTimeChange(
    existing: { title: string; dayOfWeek: number; startTime: string; endTime: string; enrollments: { member: { email: string; firstName: string } }[] },
    updated: { dayOfWeek: number; startTime: string; endTime: string },
  ) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Class Schedule Updated: ${existing.title}`,
          'class-updated',
          {
            firstName: enrollment.member.firstName,
            classTitle: existing.title,
            oldDay: DAY_NAMES[existing.dayOfWeek],
            oldTime: `${existing.startTime} - ${existing.endTime}`,
            newDay: DAY_NAMES[updated.dayOfWeek],
            newTime: `${updated.startTime} - ${updated.endTime}`,
          },
        )
        .catch((err) =>
          this.logger.error(`Failed to send class update email: ${err.message}`),
        );
    }
  }

  private notifyCancellation(
    existing: { title: string; dayOfWeek: number; startTime: string; endTime: string; enrollments: { member: { email: string; firstName: string } }[] },
  ) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Class Cancelled: ${existing.title}`,
          'class-cancelled',
          {
            firstName: enrollment.member.firstName,
            classTitle: existing.title,
            day: DAY_NAMES[existing.dayOfWeek],
            time: `${existing.startTime} - ${existing.endTime}`,
          },
        )
        .catch((err) =>
          this.logger.error(`Failed to send class cancelled email: ${err.message}`),
        );
    }
  }
}
```

**Step 4: Run tests**

Run: `yarn test -- --testPathPattern=gym-classes`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/gym-classes/
git commit -m "feat(gym-classes): add service with TDD tests for CRUD, enrollment, and notifications"
```

---

### Task 5: Create Email Templates

**Files:**
- Create: `src/email/templates/class-updated.hbs`
- Create: `src/email/templates/class-cancelled.hbs`

**Step 1: Create class-updated.hbs**

```handlebars
{{> header}}

<h2>Hi {{firstName}},</h2>

<p>The schedule for <strong>{{classTitle}}</strong> has been updated.</p>

<table style="border-collapse: collapse; margin: 16px 0;">
  <tr>
    <td style="padding: 8px 16px; font-weight: bold;">Previous</td>
    <td style="padding: 8px 16px;">{{oldDay}} {{oldTime}}</td>
  </tr>
  <tr>
    <td style="padding: 8px 16px; font-weight: bold;">New</td>
    <td style="padding: 8px 16px;">{{newDay}} {{newTime}}</td>
  </tr>
</table>

<p>Please update your schedule accordingly.</p>

{{> footer}}
```

**Step 2: Create class-cancelled.hbs**

```handlebars
{{> header}}

<h2>Hi {{firstName}},</h2>

<p>We're sorry to inform you that <strong>{{classTitle}}</strong> scheduled for <strong>{{day}} {{time}}</strong> has been cancelled.</p>

<p>Please check the class schedule for alternative sessions.</p>

{{> footer}}
```

**Step 3: Commit**

```bash
git add src/email/templates/
git commit -m "feat(email): add class-updated and class-cancelled email templates"
```

---

### Task 6: Create GymClasses Controller and Module

**Files:**
- Create: `src/gym-classes/gym-classes.controller.ts`
- Create: `src/gym-classes/gym-classes.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create gym-classes.controller.ts**

```typescript
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { GymClassesService } from './gym-classes.service';
import { CreateGymClassDto } from './dto/create-gym-class.dto';
import { UpdateGymClassDto } from './dto/update-gym-class.dto';
import {
  GymClassResponseDto,
  PaginatedGymClassesResponseDto,
} from './dto/gym-class-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Gym Classes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('gym-classes')
@UseGuards(JwtAuthGuard)
export class GymClassesController {
  constructor(private readonly gymClassesService: GymClassesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: GymClassResponseDto })
  @ApiConflictResponse({ description: 'Time overlaps with existing class' })
  create(@Body() dto: CreateGymClassDto) {
    return this.gymClassesService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedGymClassesResponseDto })
  findAll(@Query() query: PaginationQueryDto) {
    return this.gymClassesService.findAll(query.page, query.limit);
  }

  @Get('my')
  @ApiOkResponse({ description: 'Classes the authenticated member is enrolled in' })
  getMyClasses(@CurrentUser('id') memberId: string) {
    return this.gymClassesService.getMyClasses(memberId);
  }

  @Get(':id')
  @ApiOkResponse({ type: GymClassResponseDto })
  @ApiNotFoundResponse({ description: 'Class not found' })
  findOne(@Param('id') id: string) {
    return this.gymClassesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: GymClassResponseDto })
  @ApiNotFoundResponse({ description: 'Class not found' })
  @ApiConflictResponse({ description: 'Time overlaps with existing class' })
  update(@Param('id') id: string, @Body() dto: UpdateGymClassDto) {
    return this.gymClassesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Class deactivated' })
  @ApiNotFoundResponse({ description: 'Class not found' })
  remove(@Param('id') id: string) {
    return this.gymClassesService.remove(id);
  }

  @Post(':id/enroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiCreatedResponse({ description: 'Enrolled in class' })
  @ApiNotFoundResponse({ description: 'Class not found or inactive' })
  enroll(@Param('id') classId: string, @CurrentUser('id') memberId: string) {
    return this.gymClassesService.enroll(classId, memberId);
  }

  @Post(':id/unenroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiOkResponse({ description: 'Unenrolled from class' })
  unenroll(@Param('id') classId: string, @CurrentUser('id') memberId: string) {
    return this.gymClassesService.unenroll(classId, memberId);
  }

  @Get(':id/enrollments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'List of enrolled members' })
  getEnrollments(@Param('id') classId: string) {
    return this.gymClassesService.getEnrollments(classId);
  }
}
```

**Step 2: Create gym-classes.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { GymClassesService } from './gym-classes.service';
import { GymClassesController } from './gym-classes.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [GymClassesController],
  providers: [GymClassesService],
  exports: [GymClassesService],
})
export class GymClassesModule {}
```

**Step 3: Register in app.module.ts**

Add import and registration in `src/app.module.ts`:

```typescript
// Add import at top:
import { GymClassesModule } from './gym-classes/gym-classes.module';

// Add to imports array (after TrainersModule):
GymClassesModule,
```

**Step 4: Run all tests**

Run: `yarn test`
Expected: All tests pass (gym-classes and trainers).

**Step 5: Commit**

```bash
git add src/gym-classes/ src/app.module.ts
git commit -m "feat(gym-classes): add controller, module, and register in app"
```

---

### Task 7: Update CLAUDE.md and Run Final Verification

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Add `gym-classes/` to the Modules list:

```markdown
- `gym-classes/` — Independent class scheduling with member enrollment. Classes exist as standalone weekly time slots, optionally assigned a trainer. Members self-enroll. Email notifications on time changes and cancellations. Time overlap validation prevents scheduling conflicts.
```

Update the `trainers/` description to remove schedule references:

```markdown
- `trainers/` — Profiles, 1:1 member assignments
```

**Step 2: Run lint**

Run: `yarn lint`
Expected: No errors.

**Step 3: Run full test suite**

Run: `yarn test`
Expected: All tests pass.

**Step 4: Run build**

Run: `yarn build`
Expected: Builds successfully.

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with gym-classes module"
```
