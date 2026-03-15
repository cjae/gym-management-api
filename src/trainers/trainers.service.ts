import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrainerProfileDto } from './dto/create-trainer-profile.dto';
import { UpdateTrainerProfileDto } from './dto/update-trainer-profile.dto';
import { AssignMemberDto } from './dto/assign-member.dto';

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
export class TrainersService {
  constructor(private prisma: PrismaService) {}

  async createProfile(dto: CreateTrainerProfileDto) {
    return this.prisma.trainerProfile.create({
      data: {
        userId: dto.userId,
        specialization: dto.specialization,
        bio: dto.bio,
        availability: dto.availability as Prisma.InputJsonValue,
      },
      include: { user: { select: safeUserSelect } },
    });
  }

  async findAll(page: number = 1, limit: number = 20) {
    const [data, total] = await Promise.all([
      this.prisma.trainerProfile.findMany({
        include: {
          user: { select: safeUserSelect },
          classes: { where: { isActive: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.trainerProfile.count(),
    ]);
    return { data, total, page, limit };
  }

  async updateProfile(id: string, dto: UpdateTrainerProfileDto) {
    return this.prisma.trainerProfile.update({
      where: { id },
      data: {
        specialization: dto.specialization,
        bio: dto.bio,
        availability: dto.availability as Prisma.InputJsonValue,
      },
      include: { user: { select: safeUserSelect } },
    });
  }

  async findOne(id: string) {
    return this.prisma.trainerProfile.findUnique({
      where: { id },
      include: {
        user: { select: safeUserSelect },
        classes: { where: { isActive: true } },
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

  async findByUserId(userId: string) {
    return this.prisma.trainerProfile.findUnique({
      where: { userId },
      include: {
        user: { select: safeUserSelect },
        classes: { where: { isActive: true } },
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
          include: {
            user: { select: safeUserSelect },
            classes: { where: { isActive: true } },
          },
        },
      },
    });
  }
}
