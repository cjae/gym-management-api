# Events Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an events module for one-off, date-specific gym activities (special classes, community events, workshops) with member enrollment and capacity limits.

**Architecture:** Standalone `events/` module mirroring the existing `gym-classes/` pattern. New `Event` and `EventEnrollment` Prisma models. Controller → service → Prisma (no repository layer). Reuses `IsEndTimeAfterStartTime` validator from gym-classes. Email notifications on event changes/cancellation.

**Tech Stack:** NestJS 11, Prisma 6, class-validator, @nestjs/swagger, Jest + jest-mock-extended

---

### Task 1: Prisma Schema — Add Event and EventEnrollment Models

**Files:**
- Modify: `prisma/schema.prisma` (add after line 264, the ClassEnrollment model)

**Step 1: Add Event and EventEnrollment models to the schema**

Add these models after `ClassEnrollment` (after line 264):

```prisma
model Event {
  id          String   @id @default(uuid())
  title       String
  description String?
  date        DateTime @db.Date
  startTime   String   // HH:mm 24h format
  endTime     String   // HH:mm 24h format
  location    String?
  maxCapacity Int      @default(50)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  enrollments EventEnrollment[]
}

model EventEnrollment {
  id         String   @id @default(uuid())
  eventId    String
  memberId   String
  enrolledAt DateTime @default(now())

  event  Event @relation(fields: [eventId], references: [id])
  member User  @relation(fields: [memberId], references: [id])

  @@unique([eventId, memberId])
}
```

**Step 2: Add the `eventEnrollments` relation to the User model**

In the `User` model (around line 137, after `classEnrollments`), add:

```prisma
  eventEnrollments           EventEnrollment[]
```

**Step 3: Generate Prisma client and create migration**

Run:
```bash
npx prisma migrate dev --name add-events-module
```

Expected: Migration created and applied, Prisma client regenerated.

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(events): add Event and EventEnrollment models to schema"
```

---

### Task 2: DTOs — Create Event DTOs

**Files:**
- Create: `src/events/dto/create-event.dto.ts`
- Create: `src/events/dto/update-event.dto.ts`
- Create: `src/events/dto/event-response.dto.ts`

**Step 1: Create CreateEventDto**

```typescript
// src/events/dto/create-event.dto.ts
import {
  IsString,
  IsOptional,
  IsInt,
  IsDateString,
  Min,
  MaxLength,
  Matches,
  Validate,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEndTimeAfterStartTime } from '../../gym-classes/dto/validators/end-time-after-start-time.validator';

export class CreateEventDto {
  @ApiProperty({ example: 'Outdoor Bootcamp' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'A community outdoor fitness event at Uhuru Park' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: '2026-04-15', description: 'Event date (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '09:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be in HH:MM 24-hour format',
  })
  startTime: string;

  @ApiProperty({ example: '11:00', description: '24-hour format HH:MM' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'endTime must be in HH:MM 24-hour format',
  })
  @Validate(IsEndTimeAfterStartTime)
  endTime: string;

  @ApiPropertyOptional({ example: 'Uhuru Park, Nairobi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;
}
```

**Step 2: Create UpdateEventDto**

```typescript
// src/events/dto/update-event.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateEventDto } from './create-event.dto';

export class UpdateEventDto extends PartialType(CreateEventDto) {}
```

**Step 3: Create EventResponseDto**

```typescript
// src/events/dto/event-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  date: Date;

  @ApiProperty()
  startTime: string;

  @ApiProperty()
  endTime: string;

  @ApiPropertyOptional()
  location?: string;

  @ApiProperty()
  maxCapacity: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedEventsResponseDto {
  @ApiProperty({ type: [EventResponseDto] })
  data: EventResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
```

**Step 4: Commit**

```bash
git add src/events/dto/
git commit -m "feat(events): add event DTOs"
```

---

### Task 3: Service — Create EventsService with Tests (TDD)

**Files:**
- Create: `src/events/events.service.ts`
- Create: `src/events/events.service.spec.ts`

**Step 1: Write the test file**

```typescript
// src/events/events.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let emailService: DeepMockProxy<EmailService>;

  const futureDate = new Date('2026-05-01');
  const pastDate = new Date('2025-01-01');

  const mockEvent = {
    id: 'event-1',
    title: 'Outdoor Bootcamp',
    description: 'Community outdoor fitness event',
    date: futureDate,
    startTime: '09:00',
    endTime: '11:00',
    location: 'Uhuru Park',
    maxCapacity: 50,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockEnrollment = {
    id: 'enroll-1',
    eventId: 'event-1',
    memberId: 'member-1',
    enrolledAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EmailService, useValue: mockDeep<EmailService>() },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an event', async () => {
      prisma.event.create.mockResolvedValue(mockEvent as any);

      const result = await service.create({
        title: 'Outdoor Bootcamp',
        date: '2026-05-01',
        startTime: '09:00',
        endTime: '11:00',
        location: 'Uhuru Park',
      });

      expect(result).toEqual(mockEvent);
      expect(prisma.event.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated upcoming active events', async () => {
      prisma.event.findMany.mockResolvedValue([mockEvent] as any);
      prisma.event.count.mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({
        data: [mockEvent],
        total: 1,
        page: 1,
        limit: 20,
      });
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return an event by id', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);

      const result = await service.findOne('event-1');
      expect(result).toEqual(mockEvent);
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
      } as any);

      await expect(service.findOne('event-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update an event', async () => {
      const updated = { ...mockEvent, title: 'Indoor Bootcamp' };
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [],
      } as any);
      prisma.event.update.mockResolvedValue(updated as any);

      const result = await service.update('event-1', { title: 'Indoor Bootcamp' });
      expect(result.title).toBe('Indoor Bootcamp');
    });

    it('should send emails when date/time/location changes', async () => {
      const updated = { ...mockEvent, startTime: '10:00', endTime: '12:00' };
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [{ member: { email: 'a@b.com', firstName: 'John' } }],
      } as any);
      prisma.event.update.mockResolvedValue(updated as any);
      emailService.sendEmail.mockResolvedValue(undefined);

      await service.update('event-1', { startTime: '10:00', endTime: '12:00' });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Event Updated'),
        'event-updated',
        expect.any(Object),
      );
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft-delete and notify enrolled members', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        enrollments: [{ member: { email: 'a@b.com', firstName: 'John' } }],
      } as any);
      prisma.event.update.mockResolvedValue({
        ...mockEvent,
        isActive: false,
      } as any);
      emailService.sendEmail.mockResolvedValue(undefined);

      const result = await service.remove('event-1');

      expect(result.isActive).toBe(false);
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('Event Cancelled'),
        'event-cancelled',
        expect.any(Object),
      );
    });
  });

  describe('enroll', () => {
    it('should enroll a member in an event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        _count: { enrollments: 5 },
      } as any);
      prisma.eventEnrollment.create.mockResolvedValue(mockEnrollment as any);

      const result = await service.enroll('event-1', 'member-1');
      expect(result).toEqual(mockEnrollment);
    });

    it('should throw NotFoundException for inactive event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        isActive: false,
        _count: { enrollments: 0 },
      } as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when event is at capacity', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        maxCapacity: 50,
        _count: { enrollments: 50 },
      } as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException for past event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        date: pastDate,
        _count: { enrollments: 0 },
      } as any);

      await expect(service.enroll('event-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('unenroll', () => {
    it('should remove enrollment', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);
      prisma.eventEnrollment.deleteMany.mockResolvedValue({ count: 1 });

      await service.unenroll('event-1', 'member-1');

      expect(prisma.eventEnrollment.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', memberId: 'member-1' },
      });
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.unenroll('event-1', 'member-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for past event', async () => {
      prisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        date: pastDate,
      } as any);

      await expect(service.unenroll('event-1', 'member-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getEnrollments', () => {
    it('should return enrollments for an event', async () => {
      prisma.event.findUnique.mockResolvedValue(mockEvent as any);
      prisma.eventEnrollment.findMany.mockResolvedValue([mockEnrollment] as any);

      const result = await service.getEnrollments('event-1');
      expect(result).toEqual([mockEnrollment]);
    });

    it('should throw NotFoundException when event not found', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.getEnrollments('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyEvents', () => {
    it('should return events a member is enrolled in', async () => {
      prisma.eventEnrollment.findMany.mockResolvedValue([
        { ...mockEnrollment, event: mockEvent },
      ] as any);

      const result = await service.getMyEvents('member-1');
      expect(result).toHaveLength(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test -- --testPathPattern=events.service`
Expected: FAIL — `EventsService` module not found.

**Step 3: Write the service implementation**

```typescript
// src/events/events.service.ts
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

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
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async create(dto: CreateEventDto) {
    return this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        date: new Date(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        maxCapacity: dto.maxCapacity ?? 50,
      },
    });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const where = { isActive: true, date: { gte: now } };

    const [data, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: { _count: { select: { enrollments: true } } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: safeUserSelect } },
        },
      },
    });

    if (!event || !event.isActive) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  async update(id: string, dto: UpdateEventDto) {
    const existing = await this.prisma.event.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        date: dto.date ? new Date(dto.date) : undefined,
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        maxCapacity: dto.maxCapacity,
      },
    });

    const detailsChanged =
      (dto.date && new Date(dto.date).getTime() !== existing.date.getTime()) ||
      (dto.startTime && dto.startTime !== existing.startTime) ||
      (dto.endTime && dto.endTime !== existing.endTime) ||
      (dto.location !== undefined && dto.location !== existing.location);

    if (detailsChanged && existing.enrollments.length > 0) {
      this.notifyEventUpdate(existing, updated);
    }

    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.event.findUnique({
      where: { id },
      include: {
        enrollments: {
          include: { member: { select: { email: true, firstName: true } } },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    const result = await this.prisma.event.update({
      where: { id },
      data: { isActive: false },
    });

    if (existing.enrollments.length > 0) {
      this.notifyCancellation(existing);
    }

    return result;
  }

  async enroll(eventId: string, memberId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { enrollments: true } } },
    });

    if (!event || !event.isActive) {
      throw new NotFoundException('Event not found or is inactive');
    }

    if (event.date < new Date(new Date().toISOString().split('T')[0])) {
      throw new BadRequestException('Cannot enroll in a past event');
    }

    if (event._count.enrollments >= event.maxCapacity) {
      throw new ConflictException('Event is full');
    }

    return this.prisma.eventEnrollment.create({
      data: { eventId, memberId },
    });
  }

  async unenroll(eventId: string, memberId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.date < new Date(new Date().toISOString().split('T')[0])) {
      throw new BadRequestException('Cannot unenroll from a past event');
    }

    await this.prisma.eventEnrollment.deleteMany({
      where: { eventId, memberId },
    });
  }

  async getEnrollments(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return this.prisma.eventEnrollment.findMany({
      where: { eventId },
      include: { member: { select: safeUserSelect } },
    });
  }

  async getMyEvents(memberId: string) {
    return this.prisma.eventEnrollment.findMany({
      where: {
        memberId,
        event: { isActive: true },
      },
      include: { event: true },
      orderBy: { event: { date: 'asc' } },
    });
  }

  private notifyEventUpdate(
    existing: {
      title: string;
      date: Date;
      startTime: string;
      endTime: string;
      location: string | null;
      enrollments: { member: { email: string; firstName: string } }[];
    },
    updated: {
      date: Date;
      startTime: string;
      endTime: string;
      location: string | null;
    },
  ) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Event Updated: ${existing.title}`,
          'event-updated',
          {
            firstName: enrollment.member.firstName,
            eventTitle: existing.title,
            oldDate: existing.date.toISOString().split('T')[0],
            oldTime: `${existing.startTime} - ${existing.endTime}`,
            oldLocation: existing.location || 'TBD',
            newDate: updated.date.toISOString().split('T')[0],
            newTime: `${updated.startTime} - ${updated.endTime}`,
            newLocation: updated.location || 'TBD',
          },
        )
        .catch((err) =>
          this.logger.error(`Failed to send event update email: ${err.message}`),
        );
    }
  }

  private notifyCancellation(existing: {
    title: string;
    date: Date;
    startTime: string;
    endTime: string;
    location: string | null;
    enrollments: { member: { email: string; firstName: string } }[];
  }) {
    for (const enrollment of existing.enrollments) {
      this.emailService
        .sendEmail(
          enrollment.member.email,
          `Event Cancelled: ${existing.title}`,
          'event-cancelled',
          {
            firstName: enrollment.member.firstName,
            eventTitle: existing.title,
            date: existing.date.toISOString().split('T')[0],
            time: `${existing.startTime} - ${existing.endTime}`,
            location: existing.location || 'TBD',
          },
        )
        .catch((err) =>
          this.logger.error(`Failed to send event cancelled email: ${err.message}`),
        );
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `yarn test -- --testPathPattern=events.service`
Expected: All 16 tests PASS.

**Step 5: Commit**

```bash
git add src/events/events.service.ts src/events/events.service.spec.ts
git commit -m "feat(events): add EventsService with full test coverage"
```

---

### Task 4: Controller — Create EventsController

**Files:**
- Create: `src/events/events.controller.ts`

**Step 1: Write the controller**

```typescript
// src/events/events.controller.ts
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
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import {
  EventResponseDto,
  PaginatedEventsResponseDto,
} from './dto/event-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Events')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ type: EventResponseDto })
  create(@Body() dto: CreateEventDto) {
    return this.eventsService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: PaginatedEventsResponseDto })
  findAll(@Query() query: PaginationQueryDto) {
    return this.eventsService.findAll(query.page, query.limit);
  }

  @Get('my')
  @ApiOkResponse({ description: 'Events the authenticated member is enrolled in' })
  getMyEvents(@CurrentUser('id') memberId: string) {
    return this.eventsService.getMyEvents(memberId);
  }

  @Get(':id')
  @ApiOkResponse({ type: EventResponseDto })
  @ApiNotFoundResponse({ description: 'Event not found' })
  findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: EventResponseDto })
  @ApiNotFoundResponse({ description: 'Event not found' })
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'Event deactivated' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  remove(@Param('id') id: string) {
    return this.eventsService.remove(id);
  }

  @Post(':id/enroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiCreatedResponse({ description: 'Enrolled in event' })
  @ApiNotFoundResponse({ description: 'Event not found or inactive' })
  @ApiConflictResponse({ description: 'Event is full' })
  @ApiBadRequestResponse({ description: 'Cannot enroll in past event' })
  enroll(@Param('id') eventId: string, @CurrentUser('id') memberId: string) {
    return this.eventsService.enroll(eventId, memberId);
  }

  @Post(':id/unenroll')
  @UseGuards(RolesGuard)
  @Roles('MEMBER')
  @ApiOkResponse({ description: 'Unenrolled from event' })
  @ApiBadRequestResponse({ description: 'Cannot unenroll from past event' })
  unenroll(@Param('id') eventId: string, @CurrentUser('id') memberId: string) {
    return this.eventsService.unenroll(eventId, memberId);
  }

  @Get(':id/enrollments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'List of enrolled members' })
  getEnrollments(@Param('id') eventId: string) {
    return this.eventsService.getEnrollments(eventId);
  }
}
```

**Step 2: Commit**

```bash
git add src/events/events.controller.ts
git commit -m "feat(events): add EventsController"
```

---

### Task 5: Module — Create EventsModule and Register in AppModule

**Files:**
- Create: `src/events/events.module.ts`
- Modify: `src/app.module.ts`

**Step 1: Create EventsModule**

```typescript
// src/events/events.module.ts
import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
```

**Step 2: Register EventsModule in AppModule**

In `src/app.module.ts`, add the import and include `EventsModule` in the `imports` array (after `GymClassesModule`).

Add to imports at top:
```typescript
import { EventsModule } from './events/events.module';
```

Add to `@Module.imports` array (after `GymClassesModule`):
```typescript
    EventsModule,
```

**Step 3: Run all tests to ensure nothing is broken**

Run: `yarn test`
Expected: All tests pass (existing + new events tests).

**Step 4: Commit**

```bash
git add src/events/events.module.ts src/app.module.ts
git commit -m "feat(events): register EventsModule in AppModule"
```

---

### Task 6: Seed Data — Add Sample Events

**Files:**
- Modify: `prisma/seed.ts`

**Step 1: Add event seed data at the end of `main()` (before the closing log)**

Add before `console.log('Seed data created successfully');`:

```typescript
  // ── Events (upcoming community events) ──
  const event1 = await prisma.event.create({
    data: {
      title: 'Outdoor Bootcamp',
      description: 'Community outdoor fitness event at Uhuru Park. All fitness levels welcome!',
      date: daysFromNow(7),
      startTime: '07:00',
      endTime: '09:00',
      location: 'Uhuru Park, Nairobi',
      maxCapacity: 100,
    },
  });

  const event2 = await prisma.event.create({
    data: {
      title: 'Nutrition Workshop',
      description: 'Learn about meal prep and sports nutrition from our certified nutritionist.',
      date: daysFromNow(14),
      startTime: '14:00',
      endTime: '16:00',
      location: 'Studio A',
      maxCapacity: 30,
    },
  });

  const event3 = await prisma.event.create({
    data: {
      title: 'Members BBQ & Social',
      description: 'End-of-month social event for all gym members. Food and drinks provided!',
      date: daysFromNow(21),
      startTime: '12:00',
      endTime: '15:00',
      location: 'Gym Rooftop',
      maxCapacity: 80,
    },
  });

  // Enroll some members in events
  await prisma.eventEnrollment.createMany({
    data: [
      { eventId: event1.id, memberId: members[0].id },
      { eventId: event1.id, memberId: members[1].id },
      { eventId: event1.id, memberId: members[2].id },
      { eventId: event2.id, memberId: members[0].id },
      { eventId: event2.id, memberId: members[3].id },
      { eventId: event3.id, memberId: members[1].id },
      { eventId: event3.id, memberId: members[4].id },
      { eventId: event3.id, memberId: members[5].id },
    ],
  });
```

**Step 2: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(events): add event seed data"
```

---

### Task 7: Email Templates — Add Event Email Templates

**Files:**
- Create: `src/email/templates/event-updated.hbs`
- Create: `src/email/templates/event-cancelled.hbs`

**Step 1: Check existing email templates for reference**

Read `src/email/templates/class-updated.hbs` and `src/email/templates/class-cancelled.hbs` to match style.

**Step 2: Create event-updated template**

Model it after `class-updated.hbs`, replacing class-specific fields with event fields (eventTitle, oldDate/newDate, oldTime/newTime, oldLocation/newLocation).

**Step 3: Create event-cancelled template**

Model it after `class-cancelled.hbs`, replacing class-specific fields with event fields (eventTitle, date, time, location).

**Step 4: Commit**

```bash
git add src/email/templates/event-updated.hbs src/email/templates/event-cancelled.hbs
git commit -m "feat(events): add email templates for event updates and cancellations"
```

---

### Task 8: Update CLAUDE.md — Document Events Module

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add events module description**

In the **Modules** section of CLAUDE.md (after `gym-classes/` entry), add:

```
- `events/` — One-off gym events (special classes, community events, workshops). Members enroll with capacity limits. Email notifications on changes/cancellations. No trainer assignment, no time overlap validation. `GET /events` returns upcoming events (date >= today). Free for all members.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add events module to CLAUDE.md"
```
