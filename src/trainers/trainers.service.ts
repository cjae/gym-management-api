import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrainerProfileDto } from './dto/create-trainer-profile.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { AssignMemberDto } from './dto/assign-member.dto';

@Injectable()
export class TrainersService {
  constructor(private prisma: PrismaService) {}

  async createProfile(dto: CreateTrainerProfileDto) {
    return this.prisma.trainerProfile.create({
      data: {
        userId: dto.userId,
        specialization: dto.specialization,
        bio: dto.bio,
        availability: dto.availability,
      },
      include: { user: true },
    });
  }

  async findAll() {
    return this.prisma.trainerProfile.findMany({
      include: { user: true, schedules: true },
    });
  }

  async findOne(id: string) {
    return this.prisma.trainerProfile.findUnique({
      where: { id },
      include: {
        user: true,
        schedules: true,
        assignments: {
          include: {
            member: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
  }

  async addSchedule(trainerId: string, dto: CreateScheduleDto) {
    return this.prisma.trainerSchedule.create({
      data: {
        trainerId,
        title: dto.title,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        maxCapacity: dto.maxCapacity ?? 10,
      },
    });
  }

  async getSchedules(trainerId: string) {
    return this.prisma.trainerSchedule.findMany({
      where: { trainerId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async assignMember(dto: AssignMemberDto) {
    return this.prisma.trainerAssignment.create({
      data: {
        trainerId: dto.trainerId,
        memberId: dto.memberId,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
      },
    });
  }

  async getMemberTrainer(memberId: string) {
    return this.prisma.trainerAssignment.findFirst({
      where: { memberId, endDate: null },
      include: {
        trainer: {
          include: { user: true, schedules: true },
        },
      },
    });
  }
}
