import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, TagSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

const SYSTEM_TAGS = [
  { name: 'new-member', description: 'Joined recently', color: '#4CAF50' },
  { name: 'active', description: 'Checked in recently', color: '#2196F3' },
  { name: 'inactive', description: 'No recent check-ins', color: '#FF9800' },
  {
    name: 'dormant',
    description: 'No check-ins for extended period',
    color: '#9E9E9E',
  },
  {
    name: 'at-risk',
    description: 'Active subscription but not visiting',
    color: '#F44336',
  },
  { name: 'expired', description: 'Subscription expired', color: '#795548' },
  {
    name: 'loyal',
    description: 'Consistent weekly attendance',
    color: '#9C27B0',
  },
  {
    name: 'frozen',
    description: 'Subscription currently frozen',
    color: '#607D8B',
  },
];

@Injectable()
export class MemberTagsService {
  private readonly logger = new Logger(MemberTagsService.name);

  constructor(
    private prisma: PrismaService,
    private gymSettingsService: GymSettingsService,
  ) {}

  async findAll(source?: TagSource) {
    const where: Prisma.TagWhereInput = {};
    if (source) where.source = source;

    return this.prisma.tag.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  async create(dto: CreateTagDto) {
    const existing = await this.prisma.tag.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Tag "${dto.name}" already exists`);
    }

    return this.prisma.tag.create({
      data: {
        name: dto.name,
        description: dto.description,
        color: dto.color,
        source: TagSource.MANUAL,
      },
    });
  }

  async update(id: string, dto: UpdateTagDto) {
    const tag = await this.findOneOrFail(id);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot modify system tags');
    }

    if (dto.name && dto.name !== tag.name) {
      const existing = await this.prisma.tag.findUnique({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`Tag "${dto.name}" already exists`);
      }
    }

    return this.prisma.tag.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
      },
    });
  }

  async delete(id: string) {
    const tag = await this.findOneOrFail(id);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot delete system tags');
    }

    return this.prisma.tag.delete({ where: { id } });
  }

  async assignTag(tagId: string, memberIds: string[], assignedBy: string) {
    const tag = await this.findOneOrFail(tagId);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot manually assign system tags');
    }

    const validMembers = await this.prisma.user.findMany({
      where: {
        id: { in: memberIds },
        role: 'MEMBER',
        deletedAt: null,
      },
      select: { id: true },
    });

    const validIds = validMembers.map((m) => m.id);

    if (validIds.length === 0) {
      throw new BadRequestException('No valid member IDs provided');
    }

    return this.prisma.memberTag.createMany({
      data: validIds.map((memberId) => ({
        tagId,
        memberId,
        assignedBy,
      })),
      skipDuplicates: true,
    });
  }

  async findMembersByTag(tagId: string, page: number = 1, limit: number = 20) {
    await this.findOneOrFail(tagId);

    const where = { tagId, member: { deletedAt: null } };
    const [memberTags, total] = await Promise.all([
      this.prisma.memberTag.findMany({
        where,
        include: {
          member: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              status: true,
              displayPicture: true,
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { assignedAt: 'desc' },
      }),
      this.prisma.memberTag.count({ where }),
    ]);

    return {
      data: memberTags.map((mt) => mt.member),
      total,
      page,
      limit,
    };
  }

  async removeTag(tagId: string, memberId: string) {
    const tag = await this.findOneOrFail(tagId);

    if (tag.source === TagSource.SYSTEM) {
      throw new BadRequestException('Cannot manually remove system tags');
    }

    return this.prisma.memberTag.deleteMany({
      where: { tagId, memberId },
    });
  }

  async getSummary() {
    const tags = await this.prisma.tag.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
      take: 100,
    });

    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      description: tag.description,
      source: tag.source,
      color: tag.color,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
      memberCount: tag._count.members,
    }));
  }

  @Cron('0 2 * * *', { timeZone: 'Africa/Nairobi' })
  async refreshSystemTags(): Promise<void> {
    this.logger.log('Starting daily system tag refresh...');

    await this.ensureSystemTags();

    const settings = await this.gymSettingsService.getCachedSettings();
    const now = new Date();

    const systemTags = await this.prisma.tag.findMany({
      where: { source: TagSource.SYSTEM },
    });
    const tagMap = new Map(systemTags.map((t) => [t.name, t.id]));

    const newMemberDays = settings?.newMemberDays ?? 14;
    const activeDays = settings?.activeDays ?? 7;
    const inactiveDays = settings?.inactiveDays ?? 14;
    const dormantDays = settings?.dormantDays ?? 30;
    const atRiskDays = settings?.atRiskDays ?? 14;
    const loyalStreakWeeks = settings?.loyalStreakWeeks ?? 4;

    let totalAssignments = 0;
    const BATCH_SIZE = 500;

    let cursor: string | undefined;
    let totalMembers = 0;

    await this.prisma.$transaction(async (tx) => {
      // Delete all system tag assignments first
      await tx.memberTag.deleteMany({
        where: { tag: { source: TagSource.SYSTEM } },
      });

      // Cursor-based batching to avoid loading all members at once
      while (true) {
        const members = await tx.user.findMany({
          where: { role: 'MEMBER', deletedAt: null },
          select: {
            id: true,
            createdAt: true,
            attendances: {
              orderBy: { checkInDate: 'desc' },
              take: 1,
              select: { checkInDate: true },
            },
            subscriptionMembers: {
              where: {
                subscription: {
                  status: { in: ['ACTIVE', 'FROZEN', 'EXPIRED'] },
                },
              },
              select: { subscription: { select: { status: true } } },
            },
            streak: {
              select: { weeklyStreak: true },
            },
          },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (members.length === 0) break;

        totalMembers += members.length;
        cursor = members[members.length - 1].id;

        const assignments: { memberId: string; tagId: string }[] = [];

        for (const member of members) {
          const lastCheckIn = member.attendances[0]?.checkInDate;
          const daysSinceCheckIn = lastCheckIn
            ? Math.floor(
                (now.getTime() - new Date(lastCheckIn).getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : null;
          const daysSinceJoined = Math.floor(
            (now.getTime() - member.createdAt.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          const inactivityDays = daysSinceCheckIn ?? daysSinceJoined;

          const subStatuses = member.subscriptionMembers.map(
            (sm) => sm.subscription.status,
          );
          const hasActive = subStatuses.includes('ACTIVE');
          const hasFrozen = subStatuses.includes('FROZEN');
          const hasExpired = subStatuses.includes('EXPIRED');

          if (daysSinceJoined <= newMemberDays && tagMap.has('new-member')) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('new-member')!,
            });
          }

          if (
            daysSinceCheckIn !== null &&
            daysSinceCheckIn <= activeDays &&
            tagMap.has('active')
          ) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('active')!,
            });
          }

          if (inactivityDays >= inactiveDays && tagMap.has('inactive')) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('inactive')!,
            });
          }

          if (inactivityDays >= dormantDays && tagMap.has('dormant')) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('dormant')!,
            });
          }

          if (
            hasActive &&
            inactivityDays >= atRiskDays &&
            tagMap.has('at-risk')
          ) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('at-risk')!,
            });
          }

          if (hasExpired && !hasActive && tagMap.has('expired')) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('expired')!,
            });
          }

          if (
            member.streak?.weeklyStreak &&
            member.streak.weeklyStreak >= loyalStreakWeeks &&
            inactivityDays < inactiveDays &&
            tagMap.has('loyal')
          ) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('loyal')!,
            });
          }

          if (hasFrozen && tagMap.has('frozen')) {
            assignments.push({
              memberId: member.id,
              tagId: tagMap.get('frozen')!,
            });
          }
        }

        if (assignments.length > 0) {
          await tx.memberTag.createMany({
            data: assignments,
            skipDuplicates: true,
          });
          totalAssignments += assignments.length;
        }

        if (members.length < BATCH_SIZE) break;
      }
    });

    this.logger.log(
      `System tag refresh complete: ${totalAssignments} assignments for ${totalMembers} members`,
    );
  }

  private async ensureSystemTags() {
    for (const tag of SYSTEM_TAGS) {
      await this.prisma.tag.upsert({
        where: { name: tag.name },
        create: { ...tag, source: TagSource.SYSTEM },
        update: {},
      });
    }
  }

  private async findOneOrFail(id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
  }
}
