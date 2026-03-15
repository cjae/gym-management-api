import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { GymSettingsService } from './gym-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('GymSettingsService', () => {
  let service: GymSettingsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GymSettingsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();
    service = module.get<GymSettingsService>(GymSettingsService);
    prisma = module.get(PrismaService);
  });

  describe('getSettings', () => {
    it('should return settings with off-peak windows', async () => {
      const settings = {
        id: 'singleton',
        timezone: 'Africa/Nairobi',
        offPeakWindows: [
          { id: 'w1', startTime: '06:00', endTime: '10:00', dayOfWeek: null },
        ],
      };
      prisma.gymSettings.findUnique.mockResolvedValue(settings as any);
      const result = await service.getSettings();
      expect(result.timezone).toBe('Africa/Nairobi');
      expect(result.offPeakWindows).toHaveLength(1);
    });

    it('should throw NotFoundException when no settings exist', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue(null);
      await expect(service.getSettings()).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsert', () => {
    it('should create settings with valid timezone', async () => {
      const settings = {
        id: 'singleton',
        timezone: 'Africa/Nairobi',
        offPeakWindows: [],
      };
      prisma.gymSettings.upsert.mockResolvedValue(settings as any);
      const result = await service.upsert({ timezone: 'Africa/Nairobi' });
      expect(result.timezone).toBe('Africa/Nairobi');
    });

    it('should reject invalid timezone', async () => {
      await expect(
        service.upsert({ timezone: 'Invalid/Timezone' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addOffPeakWindow', () => {
    it('should create window when settings exist', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue({
        id: 'singleton',
      } as any);
      prisma.offPeakWindow.create.mockResolvedValue({
        id: 'w1',
        startTime: '06:00',
        endTime: '10:00',
        dayOfWeek: null,
      } as any);
      const result = await service.addOffPeakWindow({
        startTime: '06:00',
        endTime: '10:00',
      });
      expect(result.startTime).toBe('06:00');
    });

    it('should auto-create settings if none exist', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue(null);
      prisma.gymSettings.create.mockResolvedValue({
        id: 'singleton',
      } as any);
      prisma.offPeakWindow.create.mockResolvedValue({
        id: 'w1',
        startTime: '06:00',
        endTime: '10:00',
      } as any);
      await service.addOffPeakWindow({
        startTime: '06:00',
        endTime: '10:00',
      });
      expect(prisma.gymSettings.create).toHaveBeenCalled();
    });

    it('should reject same start and end time', async () => {
      prisma.gymSettings.findUnique.mockResolvedValue({
        id: 'singleton',
      } as any);
      await expect(
        service.addOffPeakWindow({ startTime: '10:00', endTime: '10:00' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeOffPeakWindow', () => {
    it('should delete existing window', async () => {
      prisma.offPeakWindow.findUnique.mockResolvedValue({
        id: 'w1',
      } as any);
      prisma.offPeakWindow.delete.mockResolvedValue({ id: 'w1' } as any);
      await service.removeOffPeakWindow('w1');
      expect(prisma.offPeakWindow.delete).toHaveBeenCalledWith({
        where: { id: 'w1' },
      });
    });

    it('should throw NotFoundException for missing window', async () => {
      prisma.offPeakWindow.findUnique.mockResolvedValue(null);
      await expect(service.removeOffPeakWindow('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCachedSettings', () => {
    it('should return cached value on second call', async () => {
      const settings = {
        id: 'singleton',
        timezone: 'Africa/Nairobi',
        offPeakWindows: [],
      };
      prisma.gymSettings.findUnique.mockResolvedValue(settings as any);

      await service.getCachedSettings();
      await service.getCachedSettings();

      expect(prisma.gymSettings.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
