import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GymSettings, OffPeakWindow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertGymSettingsDto } from './dto/upsert-gym-settings.dto';
import { CreateOffPeakWindowDto } from './dto/create-off-peak-window.dto';

type GymSettingsWithWindows = GymSettings & { offPeakWindows: OffPeakWindow[] };

@Injectable()
export class GymSettingsService {
  private cache: {
    settings: GymSettingsWithWindows;
    cachedAt: number;
  } | null = null;

  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(private prisma: PrismaService) {}

  async getSettings() {
    const settings = await this.prisma.gymSettings.findUnique({
      where: { id: 'singleton' },
      include: { offPeakWindows: true },
    });
    if (!settings) {
      throw new NotFoundException('Gym settings not configured');
    }
    return settings;
  }

  async upsert(dto: UpsertGymSettingsDto) {
    if (dto.timezone) {
      this.validateTimezone(dto.timezone);
    }
    const settings = await this.prisma.gymSettings.upsert({
      where: { id: 'singleton' },
      create: {
        timezone: dto.timezone ?? 'Africa/Nairobi',
        ...(dto.referralRewardDays !== undefined && {
          referralRewardDays: dto.referralRewardDays,
        }),
        ...(dto.maxReferralsPerCycle !== undefined && {
          maxReferralsPerCycle: dto.maxReferralsPerCycle,
        }),
      },
      update: {
        ...(dto.timezone && { timezone: dto.timezone }),
        ...(dto.referralRewardDays !== undefined && {
          referralRewardDays: dto.referralRewardDays,
        }),
        ...(dto.maxReferralsPerCycle !== undefined && {
          maxReferralsPerCycle: dto.maxReferralsPerCycle,
        }),
      },
      include: { offPeakWindows: true },
    });
    this.invalidateCache();
    return settings;
  }

  async addOffPeakWindow(dto: CreateOffPeakWindowDto) {
    await this.prisma.gymSettings.upsert({
      where: { id: 'singleton' },
      create: { timezone: 'Africa/Nairobi' },
      update: {},
    });

    if (dto.startTime === dto.endTime) {
      throw new BadRequestException('startTime and endTime cannot be the same');
    }

    const window = await this.prisma.offPeakWindow.create({
      data: {
        gymSettingsId: 'singleton',
        dayOfWeek: dto.dayOfWeek ?? null,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
    this.invalidateCache();
    return window;
  }

  async removeOffPeakWindow(id: string) {
    const window = await this.prisma.offPeakWindow.findUnique({
      where: { id },
    });
    if (!window) {
      throw new NotFoundException(`Off-peak window with id ${id} not found`);
    }
    await this.prisma.offPeakWindow.delete({ where: { id } });
    this.invalidateCache();
    return window;
  }

  async getCachedSettings() {
    if (this.cache && Date.now() - this.cache.cachedAt < this.CACHE_TTL_MS) {
      return this.cache.settings;
    }
    const settings = await this.prisma.gymSettings.findUnique({
      where: { id: 'singleton' },
      include: { offPeakWindows: true },
    });
    if (settings) {
      this.cache = { settings, cachedAt: Date.now() };
    }
    return settings;
  }

  private invalidateCache() {
    this.cache = null;
  }

  private validateTimezone(tz: string) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      throw new BadRequestException(`Invalid timezone: ${tz}`);
    }
  }
}
